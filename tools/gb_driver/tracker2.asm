; Chiptunes GB tracker driver v2 -- learned timbre.
;
; v1 hard-coded 16 instruments and one wave shape. Real Game Boy character
; lives in the wave table (the whole voice of channel 3) and in arpeggio runs,
; which the v3 extractor was throwing away. Here the instrument bank, wave bank
; and arpeggio bank are DATA patched in per song, so they can be learned from
; the corpus instead of hand-picked.
;
; Song stream:
;   $00              end -> restart
;   $01..$7F         wait N frames
;   $80|ch           note on: next 2 bytes = midi note, instrument id
;   $90|ch           note off
;
; Instrument (4 bytes): duty-or-wave-or-noise, envelope, arp id ($FF none), flags

DEF LOADADDR EQU $3000
; 128, matching the learned bank (instruments-v1.json nInst=128) and the
; tokenizer's N_INST. This was 64 while the bank held 128: every reference
; above 63 read past the table into WaveTables, so 100% of wave and noise
; notes played garbage. Keep these three in sync: this file,
; write_gbs_v2.py, and tokenize_v*.py.
DEF N_INST   EQU 128
DEF N_WAVE   EQU 16
DEF N_ARP    EQU 16

DEF WAITC   EQU $C000
DEF CURLO   EQU $C001
DEF CURHI   EQU $C002
DEF CH_NOTE EQU $C010
DEF CH_INST EQU $C014
DEF CH_ARPP EQU $C018
DEF CH_ON   EQU $C01C
DEF CH_WAVE EQU $C020

SECTION "driver", ROM0[LOADADDR]

Init:
    ld a, $80
    ldh [$FF26], a
    ld a, $FF
    ldh [$FF25], a
    ld a, $77
    ldh [$FF24], a
    ld hl, CH_NOTE
    ld b, 24
    xor a
.clr:
    ld [hl+], a
    dec b
    jr nz, .clr
    ld a, $FF
    ld [CH_WAVE], a           ; no wave table loaded yet
    call ResetCursor
    xor a
    ld [WAITC], a
    ret

ResetCursor:
    ld a, LOW(Song)
    ld [CURLO], a
    ld a, HIGH(Song)
    ld [CURHI], a
    ret

Play:
    call StepSong
    call UpdateOrnaments
    ret

StepSong:
    ld a, [WAITC]
    or a
    jr z, .go
    dec a
    ld [WAITC], a
    ret
.go:
    ld a, [CURLO]
    ld l, a
    ld a, [CURHI]
    ld h, a
.loop:
    ld a, [hl+]
    or a
    jr z, .restart
    bit 7, a
    jr z, .setwait
    ld b, a
    and $F0
    cp $90
    jr z, .noteoff
    ld a, b
    and $03
    ld c, a
    ld a, [hl+]
    ld d, a
    ld a, [hl+]
    ld e, a
    push hl
    call NoteOn
    pop hl
    jr .loop
.noteoff:
    ld a, b
    and $03
    ld c, a
    push hl
    call NoteOff
    pop hl
    jr .loop
.setwait:
    dec a
    ld [WAITC], a
    ld a, l
    ld [CURLO], a
    ld a, h
    ld [CURHI], a
    ret
.restart:
    call ResetCursor
    ret

; d = wave table index -> copy 16 bytes into wave RAM.
; The DAC must be off while writing $FF30-$FF3F or the writes are ignored.
LoadWave:
    ld a, [CH_WAVE]
    cp d
    ret z                     ; already loaded; reloading would click
    ld a, d
    ld [CH_WAVE], a
    xor a
    ldh [$FF1A], a
    ld h, 0
    ld l, d
    add hl, hl
    add hl, hl
    add hl, hl
    add hl, hl                ; *16
    ld de, WaveTables
    add hl, de
    ld c, $30
    ld b, 16
.cp:
    ld a, [hl+]
    ldh [c], a
    inc c
    dec b
    jr nz, .cp
    ld a, $80
    ldh [$FF1A], a
    ret

; c = channel, d = note, e = instrument
NoteOn:
    ld hl, CH_NOTE
    ld b, 0
    add hl, bc
    ld [hl], d
    ld hl, CH_INST
    add hl, bc
    ld [hl], e
    ld hl, CH_ARPP
    add hl, bc
    ld [hl], 0
    ld hl, CH_ON
    add hl, bc
    ld [hl], 1
    ld h, 0
    ld l, e
    add hl, hl
    add hl, hl
    ld de, Instruments
    add hl, de
    ld a, [hl+]
    ld d, a                   ; duty / wave index / noise poly
    ld a, [hl+]
    ld e, a                   ; envelope
    ld a, c
    or a
    jr z, .c0
    dec a
    jr z, .c1
    dec a
    jr z, .c2
    ld a, e
    ldh [$FF21], a
    ld a, d
    ldh [$FF22], a
    ld a, $80
    ldh [$FF23], a
    ret
.c0:
    ld a, d
    ldh [$FF11], a
    ld a, e
    ldh [$FF12], a
    jp WriteFreqTrig
.c1:
    ld a, d
    ldh [$FF16], a
    ld a, e
    ldh [$FF17], a
    jp WriteFreqTrig
.c2:
    push bc
    call LoadWave
    pop bc
    ld a, $20
    ldh [$FF1C], a
    jp WriteFreqTrig

; Release a channel. NRx2 must be written as $00, not $08: the DAC is on
; whenever NRx2 & $F8 is non-zero, and an NRx2 write without a retrigger does
; not change a running note's volume (see README). $08 left the DAC enabled and
; the note sounding -- a measured no-op. $00 clears the DAC and silences it.
NoteOff:
    ld hl, CH_ON
    ld b, 0
    add hl, bc
    ld [hl], 0
    ld a, c
    or a
    jr z, .o0
    dec a
    jr z, .o1
    dec a
    jr z, .o2
    xor a
    ldh [$FF21], a
    ld a, $80
    ldh [$FF23], a
    ret
.o0:
    xor a
    ldh [$FF12], a
    ld a, $80
    ldh [$FF14], a
    ret
.o1:
    xor a
    ldh [$FF17], a
    ld a, $80
    ldh [$FF19], a
    ret
.o2:
    xor a
    ldh [$FF1A], a
    ld a, $FF
    ld [CH_WAVE], a
    ret

; c = channel -> a = signed semitone offset from the instrument's arp table
ArpOffset:
    ld hl, CH_INST
    ld b, 0
    add hl, bc
    ld a, [hl]
    ld h, 0
    ld l, a
    add hl, hl
    add hl, hl
    ld de, Instruments + 2
    add hl, de
    ld a, [hl]
    cp $FF
    jr nz, .have
    xor a
    ret
.have:
    and $0F
    ld h, 0
    ld l, a
    add hl, hl
    add hl, hl
    add hl, hl
    ld de, ArpTables
    add hl, de
    push hl
    ld hl, CH_ARPP
    add hl, bc
    ld a, [hl]
    and $07
    ld e, a
    pop hl
    ld d, 0
    add hl, de
    ld a, [hl]
    cp $80
    jr nz, .done
    xor a
.done:
    ret

FreqOf:                       ; a = midi -> de = freq bytes
    sub 24
    jr nc, .ok
    xor a
.ok:
    cp 85
    jr c, .ok2
    ld a, 84
.ok2:
    ld h, 0
    ld l, a
    add hl, hl
    ld de, NoteTable
    add hl, de
    ld a, [hl+]
    ld d, a
    ld a, [hl]
    ld e, a
    ret

WriteFreqTrig:
    ld hl, CH_NOTE
    ld b, 0
    add hl, bc
    ld a, [hl]
    push af
    call ArpOffset
    ld d, a
    pop af
    add a, d
    call FreqOf
    ld a, c
    or a
    jr z, .t0
    dec a
    jr z, .t1
    ld a, d
    ldh [$FF1D], a
    ld a, e
    or $80
    ldh [$FF1E], a
    ret
.t0:
    ld a, d
    ldh [$FF13], a
    ld a, e
    or $80
    ldh [$FF14], a
    ret
.t1:
    ld a, d
    ldh [$FF18], a
    ld a, e
    or $80
    ldh [$FF19], a
    ret

; per-frame arpeggio: bend the running note WITHOUT the trigger bit, or every
; frame would re-attack and the note would never sustain
UpdateOrnaments:
    ld c, 0
.next:
    ld hl, CH_ON
    ld b, 0
    add hl, bc
    ld a, [hl]
    or a
    jr z, .skip
    ld a, c
    cp 3
    jr z, .skip
    ld hl, CH_ARPP
    add hl, bc
    ld a, [hl]
    inc a
    and $07
    ld [hl], a
    ld hl, CH_NOTE
    add hl, bc
    ld a, [hl]
    push af
    call ArpOffset
    ld d, a
    pop af
    add a, d
    call FreqOf
    ld a, c
    or a
    jr z, .w0
    dec a
    jr z, .w1
    ld a, d
    ldh [$FF1D], a
    ld a, e
    ldh [$FF1E], a
    jr .skip
.w0:
    ld a, d
    ldh [$FF13], a
    ld a, e
    ldh [$FF14], a
    jr .skip
.w1:
    ld a, d
    ldh [$FF18], a
    ld a, e
    ldh [$FF19], a
.skip:
    inc c
    ld a, c
    cp 4
    jr nz, .next
    ret

INCLUDE "notetab.inc"

; --- banks patched per song by the generator ---
Instruments:
    ds N_INST * 4
WaveTables:
    ds N_WAVE * 16
ArpTables:
    ds N_ARP * 8

Song:
    db $00
