# Native command storage: verified source findings

This is a storage map, not proof of command execution semantics. The current
document projection still uses its format-7 command indexes; native format-22
playback is not established by the existing format-7 export fixtures.

## Version-dependent identity

The inspected libLSDJ command enum uses NONE=0, A=1, C through Z=2..18,
ArduinoBoy N/X/Q/Y=19..22, and B=23. B is not alphabetically inserted into that
enum. [Pinned command enum](https://github.com/stijnfrishert/libLSDJ/blob/6023c4e48ad8280abacfddba60f2689e2442d79c/liblsdj/include/lsdj/command.h).

For native formats below 8, getters return the raw command byte. At format 8
and above, getters map raw 0 to NONE, raw 1 to B, and values above 1 to enum
value `raw - 1`. This rule applies to phrase commands and both table command
columns. Thus format 22 raw 2 is A, raw 9 is K, raw 16 is T, and raw 19 is Z.
[Phrase implementation](https://github.com/stijnfrishert/libLSDJ/blob/6023c4e48ad8280abacfddba60f2689e2442d79c/liblsdj/src/phrase.c),
[table implementation](https://github.com/stijnfrishert/libLSDJ/blob/6023c4e48ad8280abacfddba60f2689e2442d79c/liblsdj/src/table.c).

Important source inconsistency: those setters shift enum values only when
greater than 1, so A=1 is written as raw 1 and subsequently read as B. They are
not reliable round-trip oracles for A in this pinned revision. A writer using
the getter-defined layout must explicitly encode A as raw 2, B as raw 1 and
NONE as raw 0; other defined nonzero commands shift by one. Verify this with
independent native fixtures rather than copying the setter branch.

## Table field addresses

| Field | Byte offset |
|---|---|
| Envelope | `0x1690` |
| Transposition | `0x3480` |
| Command 1 | `0x3680` |
| Command 1 value | `0x3880` |
| Command 2 | `0x3A80` |
| Command 2 value | `0x3C80` |

Each region contains 32 tables × 16 rows, addressed as base + table × 16 + row.
The current repository maps the last five regions, but envelope bytes at
`0x1690` remain only in raw storage. The generic `tables1` and `tables2` fields
are command 1 and its values, not additional transpose tables.
[Pinned offsets](https://github.com/stijnfrishert/libLSDJ/blob/6023c4e48ad8280abacfddba60f2689e2442d79c/liblsdj/src/song_offsets.h).

## Next implementation checks

- Keep raw bytes distinct from normalized command identity; do not rewrite
  native source fields merely to interpret them.
- Test formats 7, 8 and 22, phrase commands and both table command columns,
  including A/B/NONE, K/T/Z and unknown raw bytes.
- Preserve unknown bytes and report unsupported identities; never turn them
  into NONE to obtain a passing round trip.
- Separately verify native effects, command-only rows, latch behavior and
  table control flow in the owner's ROM. Enumeration tests cannot prove them.
