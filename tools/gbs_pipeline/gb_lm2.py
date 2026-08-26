"""Modern small-LM architecture for the chip-music model.

RoPE + RMSNorm + SwiGLU + PyTorch flash attention, no biases, tied embeddings.
Interface-compatible with gb_lm (GbLm, GbLmConfig, load/save_config) so the
trainer and generators swap over by changing one import. The embedding keeps
the attribute name `tokens` because the optimizer's no-decay grouping keys on
it — decaying a tied embedding shrinks the output head and blows up logits.
"""
from __future__ import annotations
from dataclasses import dataclass
import json, math
from pathlib import Path

import torch
from torch import nn
import torch.nn.functional as F

# Windows PyTorch ships no flash-attention kernels, and the SDPA dispatcher was
# measured silently choosing the math backend at ctx 4096: 8526 ms/iter and
# 32.6 GB spilled, vs 28 ms / 0.6 GB for the efficient kernel on this exact
# shape. Disabling math forces the efficient path -- and turns a silent 300x
# slowdown into a loud error if no fast kernel exists.
if torch.cuda.is_available():
    torch.backends.cuda.enable_math_sdp(False)


@dataclass
class GbLmConfig:
    vocab: int
    context: int = 4096
    width: int = 512
    layers: int = 8
    heads: int = 8
    dropout: float = 0.1


def save_config(path: Path, cfg: GbLmConfig) -> None:
    Path(path).write_text(json.dumps(cfg.__dict__, indent=2, sort_keys=True) + "\n",
                          encoding="utf-8")


def load_config(path: Path) -> GbLmConfig:
    return GbLmConfig(**json.loads(Path(path).read_text(encoding="utf-8")))


class Rope(nn.Module):
    def __init__(self, head_dim: int, context: int, theta: float = 10000.0):
        super().__init__()
        inv = 1.0 / (theta ** (torch.arange(0, head_dim, 2).float() / head_dim))
        t = torch.arange(context).float()
        freqs = torch.outer(t, inv)
        self.register_buffer("cos", freqs.cos(), persistent=False)
        self.register_buffer("sin", freqs.sin(), persistent=False)

    def forward(self, q: torch.Tensor, k: torch.Tensor):
        T = q.shape[-2]
        cos = self.cos[:T].to(q.dtype)
        sin = self.sin[:T].to(q.dtype)

        def rot(x):
            x1, x2 = x[..., 0::2], x[..., 1::2]
            out = torch.empty_like(x)
            out[..., 0::2] = x1 * cos - x2 * sin
            out[..., 1::2] = x1 * sin + x2 * cos
            return out
        return rot(q), rot(k)


class Block(nn.Module):
    def __init__(self, cfg: GbLmConfig, rope: Rope):
        super().__init__()
        w = cfg.width
        self.n1 = nn.RMSNorm(w, eps=1e-5)
        self.qkv = nn.Linear(w, 3 * w, bias=False)
        self.proj = nn.Linear(w, w, bias=False)
        self.n2 = nn.RMSNorm(w, eps=1e-5)
        hidden = 64 * round(w * 8 / 3 / 64)
        self.gate = nn.Linear(w, hidden, bias=False)
        self.up = nn.Linear(w, hidden, bias=False)
        self.down = nn.Linear(hidden, w, bias=False)
        self.heads = cfg.heads
        self.drop = cfg.dropout
        self.rope = rope

    def forward(self, x):
        B, T, W = x.shape
        h = self.n1(x)
        q, k, v = self.qkv(h).chunk(3, dim=-1)
        q = q.view(B, T, self.heads, W // self.heads).transpose(1, 2)
        k = k.view(B, T, self.heads, W // self.heads).transpose(1, 2)
        v = v.view(B, T, self.heads, W // self.heads).transpose(1, 2)
        q, k = self.rope(q, k)
        # No attention dropout: dropout_p > 0 at long context knocks SDPA off
        # the flash path, materializing B*H*T*T scores -- measured 18.8GB and a
        # 7x slowdown at ctx 4096 on the 4080. Regularization comes from the
        # embedding dropout and data augmentation instead (the Llama recipe).
        a = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        a = a.transpose(1, 2).reshape(B, T, W)
        x = x + self.proj(a)
        h = self.n2(x)
        x = x + self.down(F.silu(self.gate(h)) * self.up(h))
        return x


class GbLm(nn.Module):
    def __init__(self, cfg: GbLmConfig):
        super().__init__()
        self.config = cfg
        self.tokens = nn.Embedding(cfg.vocab, cfg.width)
        rope = Rope(cfg.width // cfg.heads, cfg.context)
        self.blocks = nn.ModuleList(Block(cfg, rope) for _ in range(cfg.layers))
        self.norm = nn.RMSNorm(cfg.width, eps=1e-5)
        self.head = nn.Linear(cfg.width, cfg.vocab, bias=False)
        self.head.weight = self.tokens.weight
        self.drop = nn.Dropout(cfg.dropout)
        self.apply(self._init)
        scale = 1.0 / math.sqrt(2 * cfg.layers)
        for b in self.blocks:
            nn.init.normal_(b.proj.weight, std=0.02 * scale)
            nn.init.normal_(b.down.weight, std=0.02 * scale)

    @staticmethod
    def _init(m):
        if isinstance(m, nn.Linear):
            nn.init.normal_(m.weight, std=0.02)
        elif isinstance(m, nn.Embedding):
            nn.init.normal_(m.weight, std=0.02)

    def forward(self, idx):
        x = self.drop(self.tokens(idx))
        # Gradient checkpointing: the unfused eager blocks save ~335KB/token of
        # activations (measured 16GB forward at batch 12 x ctx 4096), which
        # spills past the 4080's 16GB and throttles training ~5x. Recomputing
        # blocks in backward trades ~30% compute for ~10x less memory.
        if self.training and torch.is_grad_enabled():
            for b in self.blocks:
                x = torch.utils.checkpoint.checkpoint(b, x, use_reentrant=False)
        else:
            for b in self.blocks:
                x = b(x)
        return self.head(self.norm(x))
