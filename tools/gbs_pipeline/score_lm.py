"""Compound-event ScoreLM used after the MIDI preservation gate.

Each input element is a vector of compound score fields from
``tokenize_score_v2``.  Field embeddings are summed for the fields that are
active for the event kind, and each field has its own tied output head.  Loss
is masked by the target event kind so inactive zero placeholders do not become
the training objective.

This module deliberately contains no corpus loader or training loop.  The
corpus receipt and Gate-A oracle must pass before a runner is allowed to feed
real scores into it.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import math
from pathlib import Path
from typing import Mapping

import torch
from torch import nn
import torch.nn.functional as F

try:
    from .gb_lm2 import Block, Rope
    from .tokenize_score_v2 import EVENT_FIELDS, EVENT_KINDS
except ImportError:
    from gb_lm2 import Block, Rope
    from tokenize_score_v2 import EVENT_FIELDS, EVENT_KINDS


# Every compound event carries these timing fields.  Other fields are active
# only for the event kinds that semantically own them.
COMMON_FIELDS = {"kind", "barDelta", "beat", "position"}
FIELD_EVENT_KINDS = {
    "part": {"NOTE", "CONTROL", "BEND", "POLY_PRESSURE", "CHANNEL_PRESSURE"},
    "programFamily": {"NOTE"},
    "pitch": {"NOTE", "POLY_PRESSURE"},
    "duration2": {"NOTE"},
    "duration1": {"NOTE"},
    "duration0": {"NOTE"},
    "velocity": {"NOTE"},
    "tempo2": {"TEMPO"},
    "tempo1": {"TEMPO"},
    "tempo0": {"TEMPO"},
    "meterNumerator": {"METER"},
    "meterDenominatorPower": {"METER"},
    "keySharps": {"KEY"},
    "keyMinor": {"KEY"},
    "controller": {"CONTROL"},
    "controlValue": {"CONTROL"},
    "bend1": {"BEND"},
    "bend0": {"BEND"},
    "pressure": {"POLY_PRESSURE", "CHANNEL_PRESSURE"},
}

# The largest cardinalities are intentionally explicit.  ``part`` is set from
# the completed corpus receipt because it is the one unbounded-in-practice
# score dimension.
DEFAULT_CARDINALITIES = {
    "kind": 13,                 # 0 is padding; EVENT_KINDS are 1..12.
    "barDelta": 2,
    "beat": 255,
    "position": 384,
    "part": 257,
    "programFamily": 17,
    "pitch": 128,
    "duration2": 128,
    "duration1": 128,
    "duration0": 128,
    "velocity": 128,
    "tempo2": 256,
    "tempo1": 256,
    "tempo0": 256,
    "meterNumerator": 256,
    "meterDenominatorPower": 8,
    "keySharps": 15,
    "keyMinor": 2,
    "controller": 128,
    "controlValue": 128,
    "bend1": 128,
    "bend0": 128,
    "pressure": 128,
}


@dataclass
class ScoreLmConfig:
    cardinalities: dict[str, int] = field(
        default_factory=lambda: dict(DEFAULT_CARDINALITIES))
    context: int = 4096
    width: int = 512
    layers: int = 10
    heads: int = 8
    dropout: float = 0.1

    def __post_init__(self) -> None:
        missing = [name for name in EVENT_FIELDS
                   if name not in self.cardinalities]
        if missing:
            raise ValueError(f"missing score field cardinalities: {missing}")
        if self.width % self.heads:
            raise ValueError("width must be divisible by heads")
        if self.context < 1 or self.layers < 1:
            raise ValueError("context and layers must be positive")
        if any(int(size) < 2 for size in self.cardinalities.values()):
            raise ValueError("field cardinalities must include padding and values")


def save_config(path: Path, config: ScoreLmConfig) -> None:
    Path(path).write_text(json.dumps(config.__dict__, indent=2, sort_keys=True)
                           + "\n", encoding="utf-8")


def load_config(path: Path) -> ScoreLmConfig:
    return ScoreLmConfig(**json.loads(Path(path).read_text(encoding="utf-8")))


def _kind_names() -> dict[int, str]:
    return {int(value): name for name, value in EVENT_KINDS.items()}


def field_active_mask(kinds: torch.Tensor, field_name: str) -> torch.Tensor:
    """Return a boolean mask for field targets active under ``kinds``."""
    if field_name == "kind" or field_name in COMMON_FIELDS - {"kind"}:
        return kinds != 0
    names = FIELD_EVENT_KINDS.get(field_name)
    if names is None:
        raise KeyError(field_name)
    values = EVENT_KINDS
    mask = torch.zeros_like(kinds, dtype=torch.bool)
    for name in names:
        mask |= kinds == int(values[name])
    return mask


def _valid_range(field_name: str, cardinality: int) -> tuple[int, int]:
    """Return inclusive valid values for static grammar masking."""
    low, high = 0, cardinality - 1
    if field_name == "kind":
        return 1, min(12, high)
    if field_name == "barDelta":
        return 0, min(1, high)
    if field_name == "part":
        return 1, high
    if field_name == "velocity":
        return 1, high
    if field_name == "meterNumerator":
        return 1, high
    if field_name == "keySharps":
        return max(0, 7 - 7), min(14, high)
    return low, high


class ScoreLm(nn.Module):
    """Causal transformer over compound score events."""

    def __init__(self, config: ScoreLmConfig):
        super().__init__()
        self.config = config
        self.fields = tuple(EVENT_FIELDS)
        self.field_index = {name: index for index, name in enumerate(self.fields)}
        self.embeddings = nn.ModuleDict({
            name: nn.Embedding(config.cardinalities[name], config.width)
            for name in self.fields
        })
        # Block only requires the common width/heads/dropout/context attributes.
        rope = Rope(config.width // config.heads, config.context)
        self.blocks = nn.ModuleList(Block(config, rope)
                                     for _ in range(config.layers))
        self.norm = nn.RMSNorm(config.width, eps=1e-5)
        self.heads = nn.ModuleDict()
        for name in self.fields:
            head = nn.Linear(config.width, config.cardinalities[name], bias=False)
            head.weight = self.embeddings[name].weight
            self.heads[name] = head
        self.drop = nn.Dropout(config.dropout)
        self.apply(self._init)
        scale = 1.0 / math.sqrt(2 * config.layers)
        for block in self.blocks:
            nn.init.normal_(block.proj.weight, std=0.02 * scale)
            nn.init.normal_(block.down.weight, std=0.02 * scale)

    @staticmethod
    def _init(module: nn.Module) -> None:
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, std=0.02)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, std=0.02)

    def _embed(self, events: torch.Tensor) -> torch.Tensor:
        if events.ndim != 3 or events.shape[-1] != len(self.fields):
            raise ValueError("events must have shape [batch, time, fields]")
        kinds = events[..., self.field_index["kind"]]
        x = torch.zeros(*events.shape[:2], self.config.width,
                        dtype=self.embeddings["kind"].weight.dtype,
                        device=events.device)
        for name in self.fields:
            values = events[..., self.field_index[name]]
            size = self.config.cardinalities[name]
            if torch.any(values < 0) or torch.any(values >= size):
                raise ValueError(f"{name} contains a value outside 0..{size - 1}")
            active = field_active_mask(kinds, name)
            x = x + self.embeddings[name](values) * active.unsqueeze(-1)
        return self.drop(x)

    def forward(self, events: torch.Tensor) -> dict[str, torch.Tensor]:
        x = self._embed(events)
        if self.training and torch.is_grad_enabled():
            for block in self.blocks:
                x = torch.utils.checkpoint.checkpoint(block, x,
                                                      use_reentrant=False)
        else:
            for block in self.blocks:
                x = block(x)
        x = self.norm(x)
        return {name: self.heads[name](x) for name in self.fields}

    def loss(self, events: torch.Tensor,
             targets: torch.Tensor) -> tuple[torch.Tensor, dict[str, float]]:
        """Compute masked next-event loss and per-field diagnostics."""
        if events.shape != targets.shape:
            raise ValueError("events and targets must have equal shape")
        logits = self(events)
        kinds = targets[..., self.field_index["kind"]]
        total = events.new_zeros((), dtype=torch.float32)
        active_total = 0
        diagnostics: dict[str, float] = {}
        for name in self.fields:
            mask = field_active_mask(kinds, name)
            count = int(mask.sum())
            if not count:
                continue
            target = targets[..., self.field_index[name]]
            ce = F.cross_entropy(logits[name].float().reshape(-1,
                                                               logits[name].shape[-1]),
                                 target.reshape(-1), reduction="none")
            value = ce[mask.reshape(-1)].sum()
            total = total + value
            active_total += count
            diagnostics[name] = float(value.detach() / count)
        if not active_total:
            raise ValueError("targets contain no non-padding score events")
        return total / active_total, diagnostics

    def grammar_mask_logits(self, logits: Mapping[str, torch.Tensor]
                            ) -> dict[str, torch.Tensor]:
        """Mask statically invalid field values for score generation."""
        masked: dict[str, torch.Tensor] = {}
        for name, values in logits.items():
            low, high = _valid_range(name, values.shape[-1])
            allowed = torch.zeros(values.shape[-1], dtype=torch.bool,
                                   device=values.device)
            allowed[low:high + 1] = True
            output = values.masked_fill(~allowed, float("-inf"))
            masked[name] = output
        return masked


__all__ = ["DEFAULT_CARDINALITIES", "ScoreLm", "ScoreLmConfig",
           "field_active_mask", "load_config", "save_config"]
