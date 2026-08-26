// Dump APU register writes with frame-exact timestamps.
// Renders in 735-sample chunks (1/60 s at 44100 Hz), so every hooked write
// lands in a known frame -- the same bucketing the GB pipeline proved.
#include <stdio.h>
#include <stdlib.h>
#include "gme/gme.h"

extern "C" { void (*gme_tap)(int, int, int) = 0; }
static long g_frame = 0;
static void tap(int chip, int addr, int data) {
    printf("%ld %d %d %d\n", g_frame, chip, addr, data);
}

int main(int argc, char** argv) {
    if (argc < 2) { fprintf(stderr, "usage: tapdump FILE [track] [seconds]\n"); return 2; }
    int track = argc > 2 ? atoi(argv[2]) : -1;
    int seconds = argc > 3 ? atoi(argv[3]) : 75;
    Music_Emu* emu = 0;
    gme_err_t err = gme_open_file(argv[1], &emu, 44100);
    if (err) { fprintf(stderr, "open: %s\n", err); return 1; }
    int n = gme_track_count(emu);
    if (track < 0) { printf("TRACKS %d\n", n); gme_delete(emu); return 0; }
    if (track >= n) { gme_delete(emu); return 1; }
    gme_ignore_silence(emu, 0);
    err = gme_start_track(emu, track);
    if (err) { fprintf(stderr, "start: %s\n", err); gme_delete(emu); return 1; }
    gme_tap = tap;
    short buf[1470];
    long frames = (long) seconds * 60;
    for (g_frame = 0; g_frame < frames; g_frame++) {
        if (gme_play(emu, 1470, buf)) break;
        if (gme_track_ended(emu)) break;
    }
    gme_tap = 0;
    gme_delete(emu);
    printf("END %ld\n", g_frame);
    return 0;
}
