/* CYCLE-ORDERED SOUND-REGISTER WRITE PROBE
 *
 * lsdjtrace records frame-END register shadows, so repeated and intermediate
 * writes within a frame disappear -- exactly the software-envelope NRx2 updates
 * we need to see. This wraps and forwards the SM83 store8 pointer and records
 * EVERY store to $FF10..$FF3F in issue order, with the uint64 global cycle time,
 * the CGB double-speed flag, and the capture-relative frame index.
 *
 * This is a raw ordered write list, NOT a validated oracle: cross-check timing
 * against a revision-accurate reference before drawing envelope conclusions.
 * The input SAV is loaded read-only into an owned memory copy (see
 * lsdj-probe-save.h) and is never rewritten; nothing is written to disk.
 *
 * Run:       lsdjwrites ROM SAV [bootFrames] [playFrames]
 * Self-test: lsdjwrites --selftest   (no ROM/SAV; nonzero on any mismatch)
 * LSDJ_MODEL=DMG|CGB selects a model; the actual model is printed on stderr.
 */
#include "lsdj-probe-save.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <inttypes.h>
#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/core/timing.h>
#include <mgba/internal/sm83/sm83.h>
#include <mgba/internal/gb/gb.h>

#define CAP (1 << 20)
struct Ev { int frame; uint64_t time; uint8_t ds, reg, val; };
static struct Ev g_ev[CAP];
static int g_n = 0, g_overflow = 0, g_frame = 0;

static void record(int frame, uint64_t time, uint8_t ds, uint8_t reg, uint8_t val) {
	if (g_n >= CAP) { g_overflow = 1; return; }
	g_ev[g_n].frame = frame; g_ev[g_n].time = time;
	g_ev[g_n].ds = ds; g_ev[g_n].reg = reg; g_ev[g_n].val = val; g_n++;
}

static struct GB* g_gb = NULL;
static void (*g_store8)(struct SM83Core*, uint16_t, int8_t) = NULL;
static void hook(struct SM83Core* cpu, uint16_t address, int8_t value) {
	if (g_gb && address >= 0xFF10 && address <= 0xFF3F)
		record(g_frame, mTimingGlobalTime(&g_gb->timing),
		       (uint8_t) g_gb->doubleSpeed, (uint8_t)(address & 0xFF), (uint8_t) value);
	g_store8(cpu, address, value);
}

/* Recorder invariants, independent of any emulator: order, monotonic time,
 * uint64 timestamps above 2^32, and overflow flagging. */
static int recorderSelftest(void) {
	g_n = 0; g_overflow = 0;
	struct Ev in[] = {
		{ 1, 10ULL, 0, 0x12, 0x88 }, { 1, 10ULL, 0, 0x14, 0x86 },
		{ 2, 0x100000000ULL + 27, 1, 0x12, 0x09 },
		{ 2, 0x100000000ULL + 44, 1, 0x12, 0x11 },
		{ 3, 0x100000000ULL + 61, 1, 0x12, 0x18 }
	};
	int k = (int)(sizeof in / sizeof in[0]), ok = 1;
	for (int i = 0; i < k; i++) record(in[i].frame, in[i].time, in[i].ds, in[i].reg, in[i].val);
	if (g_n != k) { fprintf(stderr, "SELFTEST FAIL recorder count\n"); return 1; }
	for (int i = 0; i < k; i++)
		if (g_ev[i].frame != in[i].frame || g_ev[i].time != in[i].time ||
		    g_ev[i].ds != in[i].ds || g_ev[i].reg != in[i].reg || g_ev[i].val != in[i].val) {
			fprintf(stderr, "SELFTEST FAIL recorder order at %d\n", i); ok = 0; }
	for (int i = 1; i < k; i++)
		if (g_ev[i].time < g_ev[i - 1].time) { fprintf(stderr, "SELFTEST FAIL time monotonic\n"); ok = 0; }
	if (g_ev[k - 1].time <= 0xFFFFFFFFULL) { fprintf(stderr, "SELFTEST FAIL uint64 timestamp\n"); ok = 0; }
	g_n = CAP; g_overflow = 0; record(0, 1, 0, 0, 0);
	if (!g_overflow) { fprintf(stderr, "SELFTEST FAIL overflow\n"); ok = 0; }
	g_n = 0; g_overflow = 0;
	return ok ? 0 : 1;
}

/* Hook behavior with a fake original callback and a controlled GB timing state:
 * in-range writes are recorded with the right fields and time; all writes are
 * forwarded; out-of-range writes are forwarded but not recorded. */
static int g_fwdN = 0; static uint16_t g_fwdAddr = 0; static int8_t g_fwdVal = 0;
static void fakeStore8(struct SM83Core* cpu, uint16_t a, int8_t v) {
	(void) cpu; g_fwdN++; g_fwdAddr = a; g_fwdVal = v;
}
static int hookSelftest(void) {
	struct GB* fake = calloc(1, sizeof(struct GB));
	if (!fake) { fprintf(stderr, "SELFTEST FAIL alloc\n"); return 1; }
	static int32_t rel = 0;
	fake->timing.globalCycles = 0x100000007ULL;
	fake->timing.masterCycles = 0;
	fake->timing.relativeCycles = &rel;
	fake->timing.nextEvent = &rel;
	fake->doubleSpeed = 1;
	g_gb = fake; g_store8 = fakeStore8; g_frame = 7; g_n = 0; g_overflow = 0; g_fwdN = 0;
	struct SM83Core dummy; memset(&dummy, 0, sizeof dummy);
	int ok = 1;
	hook(&dummy, 0xFF12, (int8_t) 0x88);   /* in range: record + forward */
	hook(&dummy, 0xFF80, (int8_t) 0x11);   /* out of range: forward only */
	if (g_n != 1) { fprintf(stderr, "SELFTEST FAIL hook record count %d\n", g_n); ok = 0; }
	else if (g_ev[0].frame != 7 || g_ev[0].reg != 0x12 || g_ev[0].val != 0x88 ||
	         g_ev[0].ds != 1 || g_ev[0].time != 0x100000007ULL) {
		fprintf(stderr, "SELFTEST FAIL hook fields/time %" PRIu64 "\n", g_ev[0].time); ok = 0; }
	if (g_fwdN != 2 || g_fwdAddr != 0xFF80 || g_fwdVal != (int8_t) 0x11) {
		fprintf(stderr, "SELFTEST FAIL hook forwarding\n"); ok = 0; }
	g_gb = NULL; g_store8 = NULL; g_n = 0;
	free(fake);
	return ok ? 0 : 1;
}

static long parseFrames(const char* s, long lo, long hi) {
	if (!s || !*s) return -1;
	char* end; long v = strtol(s, &end, 10);
	if (*end || v < lo || v > hi) return -1;
	return v;
}

int main(int argc, char** argv) {
	setbuf(stdout, NULL); setbuf(stderr, NULL);
	if (argc >= 2 && !strcmp(argv[1], "--selftest")) {
		int r = recorderSelftest(), h = hookSelftest();
		if (r || h) return 1;
		printf("SELFTEST PASS: recorder order/monotonic/uint64/overflow and hook forward/filter/time\n");
		return 0;
	}
	if (argc < 3) { fprintf(stderr, "usage: lsdjwrites ROM SAV [bootFrames] [playFrames] | --selftest\n"); return 2; }
	long bootFrames = 400, playFrames = 300;
	if (argc > 3 && (bootFrames = parseFrames(argv[3], 0, 1000000)) < 0) { fprintf(stderr, "bootFrames out of range\n"); return 2; }
	if (argc > 4 && (playFrames = parseFrames(argv[4], 1, 1000000)) < 0) { fprintf(stderr, "playFrames out of range\n"); return 2; }

	struct mCore* core = mCoreFind(argv[1]);
	if (!core) { fprintf(stderr, "NO_CORE\n"); return 1; }
	core->init(core); mCoreInitConfig(core, NULL);
	const char* model = getenv("LSDJ_MODEL");
	if (model && strcmp(model, "DMG") && strcmp(model, "CGB")) {
		fprintf(stderr, "LSDJ_MODEL must be DMG or CGB\n"); return 2;
	}
	if (model) {
		const char* keys[] = { "gb.model", "sgb.model", "cgb.model", "cgb.hybridModel", "cgb.sgbModel" };
		for (int k = 0; k < 5; k++) mCoreConfigSetValue(&core->config, keys[k], model);
	}
	unsigned vw = 0, vh = 0;
	core->desiredVideoDimensions(core, &vw, &vh);
	color_t* video = calloc((size_t) vw * vh, sizeof(color_t));
	core->setVideoBuffer(core, video, vw);
	if (!mCoreLoadFile(core, argv[1])) { fprintf(stderr, "ROM_LOAD_FAILED\n"); free(video); return 1; }
	if (!lsdjProbeLoadSave(core, argv[2])) { fprintf(stderr, "SAV_LOAD_FAILED\n"); free(video); return 1; }
	core->reset(core);
	struct GB* gb = (struct GB*) core->board;
	fprintf(stderr, "MODEL=%s\n", GBModelToName(gb->model));

	for (long i = 0; i < bootFrames; i++) core->runFrame(core);

	/* Hook only after boot/upgrade so capture begins at the first START frame
	 * and includes the note's onset writes. */
	g_gb = gb; g_store8 = gb->cpu->memory.store8; gb->cpu->memory.store8 = hook;
	g_n = 0; g_overflow = 0; g_frame = 0;

	const uint32_t START = 1 << 3;   /* mGBA GB key order: A,B,Select,Start,... */
	for (int i = 0; i < 12; i++) { core->setKeys(core, START); core->runFrame(core); g_frame++; }
	core->setKeys(core, 0);
	for (int i = 0; i < 12; i++) { core->runFrame(core); g_frame++; }
	for (long f = 0; f < playFrames; f++) { core->runFrame(core); g_frame++; }

	gb->cpu->memory.store8 = g_store8;   /* restore before deinit */
	g_gb = NULL;

	printf("index,frame,time,doubleSpeed,reg,val\n");
	for (int i = 0; i < g_n; i++)
		printf("%d,%d,%" PRIu64 ",%u,FF%02X,%u\n",
		       i, g_ev[i].frame, g_ev[i].time, g_ev[i].ds, g_ev[i].reg, g_ev[i].val);

	int overflow = g_overflow;
	if (overflow) fprintf(stderr, "CAPTURE_OVERFLOW at %d events; raise CAP\n", CAP);
	core->deinit(core); free(video);
	return overflow ? 3 : 0;
}
