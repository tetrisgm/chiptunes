; Minimal GBS sound driver: a frame-delta event interpreter.
;
; The model emits (wait N frames, then write these APU registers), so the
; driver is a direct interpreter of that. Song data is a byte stream:
;   $00           end of song -> restart
;   $01..$7F      wait N frames
;   $80|reg, val  write val to $FF10+reg   (reg $00..$2F covers NR10..wave RAM)
;
; Called by the GBS host: INIT once (A = song), PLAY every frame at 59.7275 Hz.

DEF LOADADDR EQU $3000

DEF WAITC  EQU $C000
DEF CURLO  EQU $C001
DEF CURHI  EQU $C002

SECTION "driver", ROM0[LOADADDR]

Init:
    ld a, $80
    ldh [$FF26], a          ; NR52 - sound on
    ld a, $FF
    ldh [$FF25], a          ; NR51 - every channel to both sides
    ld a, $77
    ldh [$FF24], a          ; NR50 - full volume
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
    and $7F
    add a, $10
    ld c, a
    ld a, [hl+]
    ldh [c], a            ; write $FF00+C
    jr .loop
.setwait:
    dec a                 ; this frame is consumed
    ld [WAITC], a
    ld a, l
    ld [CURLO], a
    ld a, h
    ld [CURHI], a
    ret
.restart:
    call ResetCursor
    ret

Song:
    db $00                ; placeholder; the generator appends real data here
