/* Does LSDj itself play what we exported?
 *
 * liblsdj proves the file parses and LSDj's own period table proves the note
 * mapping, but only LSDj proves it ACCEPTS the save and plays it. This boots
 * the real ROM in mGBA with one of our .sav files, presses START, and reports
 * every pitch the APU is told to make.
 *
 * Two sets come out, because neither measurement is complete alone:
 *   HZ   -- sampled every frame regardless of channel state. Catches every note
 *           LSDj plays, and also picks up idle channels and mid-transition
 *           reads, so it is the set to check for MISSING notes.
 *   TRIG -- sampled only while the channel reports playing. Misses notes, but
 *           what it does report is real, so it is the set to check for WRONG
 *           notes.
 * Together: everything we wrote is played, and nothing we did not write is.
 *
 * Build (needs mGBA's library -- `brew install mgba`):
 *   clang -I$(brew --prefix)/include -L$(brew --prefix)/lib -lmgba \
 *         -o /tmp/lsdjplay tools/lsdjplay.c
 *
 * Run:  lsdjplay LSDJ.gb OUR.sav [bootFrames] [playFrames]
 *
 * The LSDj ROM is NOT in this repository and must not be: it is Johan
 * Kotlinski's, freeware for personal and educational use, and its licence
 * forbids redistribution. Point this at your own copy.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <mgba/core/core.h>
#include <mgba-util/vfs.h>
#include <mgba/core/config.h>
#include <mgba/internal/gb/gb.h>
#include <mgba/internal/gb/audio.h>

#define FF10 0xFF10

static double pulse_hz(int period) { return period >= 2048 ? 0 : 131072.0 / (2048 - period); }
static double wave_hz(int period)  { return period >= 2048 ? 0 : 65536.0  / (2048 - period); }

static void shot(const char* path, color_t* video, unsigned vw, unsigned vh) {
	if (!path) return;
	FILE* f = fopen(path, "wb");
	fprintf(f, "P6\n%u %u\n255\n", vw, vh);
	for (unsigned y = 0; y < vh; y++) for (unsigned x = 0; x < vw; x++) {
		color_t c = video[y * vw + x];
		unsigned char rgb[3] = { (unsigned char)(c & 0xFF), (unsigned char)((c >> 8) & 0xFF), (unsigned char)((c >> 16) & 0xFF) };
		fwrite(rgb, 1, 3, f);
	}
	fclose(f);
}

int main(int argc, char** argv) {
	setbuf(stdout, NULL); setbuf(stderr, NULL);
	if (argc < 3) { printf("usage: lsdjplay ROM SAV [bootFrames] [playFrames]\n"); return 2; }
	int bootFrames = argc > 3 ? atoi(argv[3]) : 400;
	int playFrames = argc > 4 ? atoi(argv[4]) : 900;
	int tracePitch = getenv("LSDJ_TRACE_PITCH") != NULL;

	struct mCore* core = mCoreFind(argv[1]);
	if (!core) { printf("NO_CORE\n"); return 1; } core->init(core);
	/* Without a config the core dereferences unset options during reset. */
	mCoreInitConfig(core, NULL);
	/* mGBA writes every frame into a caller-owned buffer; without one it faults
	   on the first runFrame. We never look at the picture -- the APU registers
	   are the point -- but the core still needs somewhere to draw. */
	unsigned vw = 0, vh = 0;
	core->desiredVideoDimensions(core, &vw, &vh);
	color_t* video = calloc((size_t)vw * vh, sizeof(color_t));
	core->setVideoBuffer(core, video, vw);
	if (!mCoreLoadFile(core, argv[1])) { printf("ROM_LOAD_FAILED\n"); return 1; }
	if (!mCoreLoadSaveFile(core, argv[2], false)) { printf("SAV_LOAD_FAILED\n"); return 1; }
	core->reset(core);

	/* LSDj boots, reads the save, and lands on the song screen. */
	for (int i = 0; i < bootFrames; i++) core->runFrame(core);
	shot(getenv("LSDJ_SHOT"), video, vw, vh);

	/* START. mGBA's GB key order is A,B,Select,Start,Right,Left,Up,Down. */
	const uint32_t START = 1 << 3;
	for (int i = 0; i < 12; i++) { core->setKeys(core, START); core->runFrame(core); }
	core->setKeys(core, 0);
	for (int i = 0; i < 12; i++) core->runFrame(core);

	double seen[4096]; int nseen = 0;
	double trigs[4096]; int ntrig = 0;
	int trig[3] = {0, 0, 0};
	for (int f = 0; f < playFrames; f++) {
		core->runFrame(core);
		/* NR13/NR23/NR33 are WRITE-ONLY on this machine, so reading them back
		   returns nothing at all -- mGBA says as much. The core's own decoded
		   channel state is the honest place to look. */
		struct GB* gb = (struct GB*) core->board;
		int per[3];
		per[0] = gb->audio.ch1.control.frequency;
		per[1] = gb->audio.ch2.control.frequency;
		per[2] = gb->audio.ch3.rate;
		/* Sample unconditionally. The playing flags track the DAC rather than a
		   note-on, so gating on them missed most pulse notes -- a fault in the
		   observer, not in what LSDj was playing. A stale period just repeats a
		   pitch we have already seen, and the comparison is over SETS. */
		int on[3] = { gb->audio.playingCh1, gb->audio.playingCh2, gb->audio.playingCh3 };
		for (int c = 0; c < 3; c++) {
			if (tracePitch) printf("PITCH %d %d %d %d\n", f, c, per[c], on[c]);
			double hz = c == 2 ? wave_hz(per[c]) : pulse_hz(per[c]);
			if (hz < 20 || hz > 20000) continue;
			if (on[c]) { int d2 = 0; for (int k = 0; k < ntrig; k++) if (trigs[k] > hz*0.997 && trigs[k] < hz*1.003) { d2 = 1; break; }
			             if (!d2 && ntrig < 4096) trigs[ntrig++] = hz; }
			trig[c]++;
			int dup = 0;
			for (int k = 0; k < nseen; k++) if (seen[k] > hz * 0.997 && seen[k] < hz * 1.003) { dup = 1; break; }
			if (!dup && nseen < 4096) seen[nseen++] = hz;
		}
	}
	shot(getenv("LSDJ_SHOT2"), video, vw, vh);
	printf("channels active (frames with a period set): PU1=%d PU2=%d WAV=%d\n", trig[0], trig[1], trig[2]);
	printf("distinct pitches=%d\n", nseen);
	printf("note-on pitches=%d\n", ntrig);
	for (int i = 0; i < nseen; i++) printf("HZ %.3f\n", seen[i]);
	for (int i = 0; i < ntrig; i++) printf("TRIG %.3f\n", trigs[i]);
	core->deinit(core);
	return 0;
}
