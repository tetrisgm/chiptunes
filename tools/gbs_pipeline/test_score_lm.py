import unittest

try:
    import torch
except ModuleNotFoundError:  # The Mac test runtime has no PyTorch installation.
    torch = None

if torch is not None:
    from score_lm import EVENT_FIELDS, ScoreLm, ScoreLmConfig, field_active_mask
    from tokenize_score_v2 import EVENT_KINDS
else:
    EVENT_FIELDS = ()
    EVENT_KINDS = {}


def event(kind: str) -> list[int]:
    row = [0] * len(EVENT_FIELDS)
    row[EVENT_FIELDS.index("kind")] = EVENT_KINDS[kind]
    row[EVENT_FIELDS.index("barDelta")] = 0
    row[EVENT_FIELDS.index("beat")] = 0
    row[EVENT_FIELDS.index("position")] = 0
    if kind == "NOTE":
        row[EVENT_FIELDS.index("part")] = 1
        row[EVENT_FIELDS.index("programFamily")] = 2
        row[EVENT_FIELDS.index("pitch")] = 60
        row[EVENT_FIELDS.index("duration0")] = 12
        row[EVENT_FIELDS.index("velocity")] = 100
    return row


@unittest.skipIf(torch is None, "PyTorch is not installed in this test runtime")
class ScoreLmTests(unittest.TestCase):
    def setUp(self) -> None:
        config = ScoreLmConfig(context=8, width=32, layers=1, heads=4,
                               dropout=0.0)
        self.model = ScoreLm(config)
        self.events = torch.tensor([
            [event("BOS"), event("NOTE"), event("BAR"), event("EOS"),
             event("NOTE"), event("EOS"), event("BOS"), event("EOS")],
        ], dtype=torch.long)

    def test_outputs_one_head_per_compound_field(self) -> None:
        logits = self.model(self.events)
        self.assertEqual(set(EVENT_FIELDS), set(logits))
        for index, name in enumerate(EVENT_FIELDS):
            self.assertEqual((1, 8, self.model.config.cardinalities[name]),
                             tuple(logits[name].shape))
            self.assertIs(self.model.heads[name].weight,
                          self.model.embeddings[name].weight)

    def test_loss_masks_inactive_note_fields_but_keeps_note_factors(self) -> None:
        targets = self.events.roll(-1, dims=1)
        loss, diagnostics = self.model.loss(self.events, targets)
        self.assertTrue(torch.isfinite(loss))
        self.assertIn("pitch", diagnostics)
        self.assertNotIn("pitch", {
            name for name in EVENT_FIELDS
            if not field_active_mask(
                targets[..., EVENT_FIELDS.index("kind")], name).any()
        })

    def test_grammar_masks_reserved_values(self) -> None:
        logits = self.model(self.events[:1, :1])
        masked = self.model.grammar_mask_logits(logits)
        self.assertTrue(torch.isneginf(masked["kind"][..., 0]).all())
        self.assertTrue(torch.isneginf(masked["velocity"][..., 0]).all())
        self.assertTrue(torch.isfinite(masked["velocity"][..., 1:]).all())


if __name__ == "__main__":
    unittest.main()
