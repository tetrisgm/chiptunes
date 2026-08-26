; Chiptunes GB tracker driver.
;
; Song data is a byte stream of frame-delta events; instruments carry the
; per-frame character (duty, hardware envelope, arpeggio) so the model emits
; notes rather than the ~200 register writes/second a Game Boy actually makes.
;
;   $00              end of song -> restart
;   $01..$7F         wait N frames
;   $80|ch           note on:  next 2 bytes = midi note, instrument id
;   $90|ch           note off
;
; Instrument record (4 bytes):
;   0: duty<<6  (pulse) | wave index (ch2) | unused (ch3)
;   1: NRx2 envelope byte  (initial volume<<4 | direction<<3 | period)
;   2: arpeggio table id ($FF = none)
;   3: reserved
;
; Arpeggio tables are $80-terminated lists of signed semitone offsets, applied
; one entry per frame and looping. That is where the Game Boy "chord" sound
; comes from, and it is why we do not flatten ornaments out of the corpus.

DEF LOADADDR EQU $3000

DEF WAITC   EQU $C000
DEF CURLO   EQU $C001
DEF CURHI   EQU $C002
DEF CH_NOTE EQU $C010   ; 4 bytes: current midi note per channel
DEF CH_INST EQU $C014   ; 4 bytes: instrument id
DEF CH_ARPP EQU $C018   ; 4 bytes: arpeggio phase
DEF CH_ON   EQU $C01C   ; 4 bytes: active flag

SECTION "driver", ROM0[LOADADDR]

Init:
    ld a, $80
    ldh [$FF26], a
    ld a, $FF
    ldh [$FF25], a
    ld a, $77
    ldh [$FF24], a
    ; clear channel state
    ld hl, CH_NOTE
    ld b, 16
    xor a
.clr:
    ld [hl+], a
    dec b
    jr nz, .clr
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
    call UpdateArps
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
    ; $80|ch note on, $90|ch note off
    ld b, a
    and $F0
    cp $90
    jr z, .noteoff
    ld a, b
    and $03
    ld c, a                 ; c = channel
    ld a, [hl+]
    ld d, a                 ; d = midi note
    ld a, [hl+]
    ld e, a                 ; e = instrument
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
    ; instrument record -> hl
    ld h, 0
    ld l, e
    add hl, hl
    add hl, hl              ; *4
    ld de, Instruments
    add hl, de
    ld a, [hl+]
    ld d, a                 ; duty / wave
    ld a, [hl+]
    ld e, a                 ; envelope byte
    ; dispatch on channel
    ld a, c
    or a
    jr z, .ch0
    dec a
    jr z, .ch1
    dec a
    jr z, .ch2
    jr .ch3
.ch0:
    ld a, d
    ldh [$FF11], a
    ld a, e
    ldh [$FF12], a
    jr .freq
.ch1:
    ld a, d
    ldh [$FF16], a
    ld a, e
    ldh [$FF17], a
    jr .freq
.ch2:
    ld a, $80
    ldh [$FF1A], a          ; DAC on
    ld a, $20
    ldh [$FF1C], a          ; output level 100%
    jr .freq
.ch3:
    ld a, e
    ldh [$FF21], a          ; NR42 envelope
    ld a, d
    ldh [$FF22], a          ; NR43 polynomial from the duty slot
    ld a, $80
    ldh [$FF23], a          ; NR44 trigger
    ret
.freq:
    call WriteFreq
    ret

; c = channel
NoteOff:
    ld hl, CH_ON
    ld b, 0
    add hl, bc
    ld [hl], 0
    ld a, c
    or a
    jr z, .c0
    dec a
    jr z, .c1
    dec a
    jr z, .c2
    ld a, $08
    ldh [$FF21], a
    ret
.c0:
    ld a, $08
    ldh [$FF12], a          ; volume 0
    ret
.c1:
    ld a, $08
    ldh [$FF17], a
    ret
.c2:
    xor a
    ldh [$FF1A], a          ; wave DAC off
    ret

; c = channel; uses CH_NOTE + arp phase; writes freq regs and triggers
WriteFreq:
    ld hl, CH_NOTE
    ld b, 0
    add hl, bc
    ld a, [hl]
    ; arpeggio offset
    push af
    call ArpOffset          ; -> a = signed offset
    ld d, a
    pop af
    add a, d
    sub 24                  ; table starts at midi 24
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
    ld e, a                 ; de = freq (lo in d, hi in e)
    ld a, c
    or a
    jr z, .f0
    dec a
    jr z, .f1
    ; ch2 wave
    ld a, d
    ldh [$FF1D], a
    ld a, e
    or $80
    ldh [$FF1E], a
    ret
.f0:
    ld a, d
    ldh [$FF13], a
    ld a, e
    or $80
    ldh [$FF14], a
    ret
.f1:
    ld a, d
    ldh [$FF18], a
    ld a, e
    or $80
    ldh [$FF19], a
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
    ld a, [hl]              ; arp table id
    cp $FF
    jr nz, .have
    xor a
    ret
.have:
    ld h, 0
    ld l, a
    add hl, hl
    add hl, hl
    add hl, hl              ; 8 bytes per arp table
    ld de, ArpTables
    add hl, de
    push hl
    ld hl, CH_ARPP
    add hl, bc
    ld a, [hl]
    ld e, a
    pop hl
    ld d, 0
    add hl, de
    ld a, [hl]
    cp $80
    jr nz, .ret
    xor a                   ; wrapped: restart at 0
.ret:
    ret

; per-frame ornament update for every active channel
UpdateArps:
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
    jr z, .skip             ; noise has no pitch
    ; advance arp phase (wrap at 8)
    ld hl, CH_ARPP
    add hl, bc
    ld a, [hl]
    inc a
    and $07
    ld [hl], a
    call WriteFreqNoTrig
.skip:
    inc c
    ld a, c
    cp 4
    jr nz, .next
    ret

; like WriteFreq but leaves the trigger bit clear, so an arpeggio bends the
; running note instead of restarting it (restarting would re-attack every frame)
WriteFreqNoTrig:
    ld hl, CH_NOTE
    ld b, 0
    add hl, bc
    ld a, [hl]
    push af
    call ArpOffset
    ld d, a
    pop af
    add a, d
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
    ld a, c
    or a
    jr z, .f0
    dec a
    jr z, .f1
    ld a, d
    ldh [$FF1D], a
    ld a, e
    ldh [$FF1E], a
    ret
.f0:
    ld a, d
    ldh [$FF13], a
    ld a, e
    ldh [$FF14], a
    ret
.f1:
    ld a, d
    ldh [$FF18], a
    ld a, e
    ldh [$FF19], a
    ret

INCLUDE "notetab.inc"

Instruments:
    ; duty/wave, envelope, arp id, reserved
    db $80, $F0, $FF, 0     ; 0: pulse 50%, full vol sustained
    db $40, $F7, $FF, 0     ; 1: pulse 25%, slow decay
    db $80, $A4, $FF, 0     ; 2: pulse 50%, medium decay
    db $C0, $D2, $FF, 0     ; 3: pulse 75%, fast decay
    db $80, $F0, $00, 0     ; 4: pulse 50% + major arpeggio
    db $40, $F2, $01, 0     ; 5: pulse 25% + minor arpeggio
    db $00, $00, $FF, 0     ; 6: wave, sustained
    db $00, $00, $00, 0     ; 7: wave + major arpeggio
    db $00, $F1, $FF, 0     ; 8: noise, short decay
    db $10, $F2, $FF, 0     ; 9: noise, snare-ish
    db $30, $A1, $FF, 0     ; 10: noise, hat
    db $80, $F3, $FF, 0     ; 11: pulse 50%, decay
    db $40, $91, $FF, 0     ; 12: pulse 25%, pluck
    db $80, $C1, $FF, 0     ; 13: pulse 50%, short
    db $00, $00, $01, 0     ; 14: wave + minor arpeggio
    db $C0, $F5, $FF, 0     ; 15: pulse 75%, long decay

ArpTables:
    db 0, 4, 7, 0, 4, 7, $80, 0      ; 0: major triad
    db 0, 3, 7, 0, 3, 7, $80, 0      ; 1: minor triad

Song:
    db $00
