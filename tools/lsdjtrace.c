/* WHAT DOES LSDJ ACTUALLY WRITE TO THE SOUND CHIP?
 *
 * `lsdjplay` answered "does LSDj play our notes" by watching decoded pitches.
 * That is enough to prove a note sounded and nothing more. Parity is a stronger
 * claim -- the same song has to SOUND the same -- and the only place that claim
 * is decidable is the APU registers, because they are the entire interface
 * between a Game Boy program and the noise it makes. Two programs that write
 * the same bytes to NR10..NR51 on the same frames are, to the hardware,
 * indistinguishable.
 *
 * So this dumps a per-frame register trace as CSV:
 *
 *   frame,NR10,NR11,...,NR51
 *
 * ...and only lines where something CHANGED, because a song is mostly silence
 * between writes and a full dump is 60 lines a second of nothing.
 *
 * The comparison this feeds is against our own engine's trace of the same song.
 * Anything that differs is a real difference in what the two make the chip do.
 *
 * Build (needs mGBA's library -- `brew install mgba`):
 *   clang -I$(brew --prefix)/include -L$(brew --prefix)/lib -lmgba \
 *         -o /tmp/lsdjtrace tools/lsdjtrace.c
 *
 * Run:  lsdjtrace LSDJ.gb OUR.sav [bootFrames] [playFrames]
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
#include <mgba/internal/gb/memory.h>

/* NR10..NR51 is 0xFF10..0xFF25. NR52 (0xFF26) is the on/off latch and its low
 * bits are channel-playing STATUS rather than anything written, so it is read
 * but never compared -- a trace that included it would differ on timing noise
 * that no listener can hear. */
#define REG_FIRST 0xFF10
/* ...through wave RAM. FF30..FF3F is the 32-nibble waveform channel 3 plays,
 * and without it a trace can say the wave channel sounded the right PITCH while
 * saying nothing about what it sounded LIKE -- which is the whole question for
 * an instrument whose timbre IS that table. */
#define REG_LAST  0xFF3F
#define NREG (REG_LAST - REG_FIRST + 1)

static const char* NAMES[NREG] = {
	"NR10","NR11","NR12","NR13","NR14","FF15",
	"NR21","NR22","NR23","NR24",
	"NR30","NR31","NR32","NR33","NR34","FF1F",
	"NR41","NR42","NR43","NR44",
	"NR50","NR51","NR52","FF27","FF28","FF29","FF2A","FF2B","FF2C","FF2D","FF2E","FF2F",
	"W0","W1","W2","W3","W4","W5","W6","W7","W8","W9","WA","WB","WC","WD","WE","WF"
};

int main(int argc, char** argv) {
	setbuf(stdout, NULL);
	if (argc < 3) { fprintf(stderr, "usage: lsdjtrace ROM SAV [bootFrames] [playFrames]\n"); return 2; }
	int bootFrames = argc > 3 ? atoi(argv[3]) : 400;
	int playFrames = argc > 4 ? atoi(argv[4]) : 1800;

	struct mCore* core = mCoreFind(argv[1]);
	if (!core) { fprintf(stderr, "NO_CORE\n"); return 1; }
	core->init(core);
	mCoreInitConfig(core, NULL);
	unsigned vw = 0, vh = 0;
	core->desiredVideoDimensions(core, &vw, &vh);
	color_t* video = calloc((size_t)vw * vh, sizeof(color_t));
	core->setVideoBuffer(core, video, vw);
	if (!mCoreLoadFile(core, argv[1])) { fprintf(stderr, "ROM_LOAD_FAILED\n"); return 1; }
	if (!mCoreLoadSaveFile(core, argv[2], false)) { fprintf(stderr, "SAV_LOAD_FAILED\n"); return 1; }
	core->reset(core);

	for (int i = 0; i < bootFrames; i++) core->runFrame(core);

	/* START, to begin playback from the song screen. */
	const uint32_t START = 1 << 3;
	for (int i = 0; i < 12; i++) { core->setKeys(core, START); core->runFrame(core); }
	core->setKeys(core, 0);
	for (int i = 0; i < 12; i++) core->runFrame(core);

	printf("frame");
	for (int r = 0; r < NREG; r++) printf(",%s", NAMES[r]);
	printf("\n");

	struct GB* gb = (struct GB*) core->board;
	uint8_t prev[NREG];
	memset(prev, 0, sizeof prev);
	int first = 1;
	for (int f = 0; f < playFrames; f++) {
		core->runFrame(core);
		uint8_t cur[NREG];
		/* The audio registers live in the IO block; reading them back through the
		 * memory map returns the OR-masks the hardware applies, which is exactly
		 * what another implementation would have to match to be indistinguishable. */
		for (int r = 0; r < NREG; r++) cur[r] = gb->memory.io[(REG_FIRST + r) - 0xFF00];
		if (first || memcmp(cur, prev, sizeof cur) != 0) {
			printf("%d", f);
			for (int r = 0; r < NREG; r++) printf(",%u", cur[r]);
			printf("\n");
			memcpy(prev, cur, sizeof cur);
			first = 0;
		}
	}
	core->deinit(core);
	free(video);
	return 0;
}
