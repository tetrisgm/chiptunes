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

/* Observable raw-tick calibration. We deliberately do NOT infer the unit of
 * mTimingGlobalTime from the double-speed flag; we accumulate the raw per-frame
 * tick delta over a stable window and report min/max with tie counts plus the
 * reduced ticks-per-frame rational, so the unit can be labeled only after a
 * cross-model comparison rather than claimed cycle-exact from a single run. */
struct TimingDiag { int frames; uint64_t sum, min, max; int minCount, maxCount; };

static void diagInit(struct TimingDiag* d) {
	d->frames = 0; d->sum = 0; d->min = UINT64_MAX; d->max = 0; d->minCount = 0; d->maxCount = 0;
}

static void diagAdd(struct TimingDiag* d, uint64_t delta) {
	d->sum += delta; d->frames++;
	if (delta < d->min) { d->min = delta; d->minCount = 1; } else if (delta == d->min) d->minCount++;
	if (delta > d->max) { d->max = delta; d->maxCount = 1; } else if (delta == d->max) d->maxCount++;
}

static uint64_t gcd64(uint64_t a, uint64_t b) {
	while (b) { uint64_t t = a % b; a = b; b = t; }
	return a ? a : 1;
}

static void diagReport(FILE* out, const char* model, int32_t freq, int32_t frameCycles,
                       int leadFrames, long playFrames, int captureFrames,
                       uint64_t tStart, uint64_t tPlayStart, uint64_t tEnd,
                       const struct TimingDiag* d,
                       uint8_t dsFirst, uint8_t dsLast, int dsChanges, int firstDsChangeFrame) {
	uint64_t num = d->frames ? d->sum : 0, den = d->frames ? (uint64_t) d->frames : 1;
	uint64_t g = gcd64(num, den);
	fprintf(out, "TIMING model=%s freq=%" PRId32 " frameCycles=%" PRId32 "\n", model, freq, frameCycles);
	fprintf(out, "TIMING captureFrames=%d leadFrames=%d playFrames=%ld\n", captureFrames, leadFrames, playFrames);
	fprintf(out, "TIMING captureStartTick=%" PRIu64 " playStartTick=%" PRIu64 " captureEndTick=%" PRIu64 "\n",
	        tStart, tPlayStart, tEnd);
	fprintf(out, "TIMING captureTickDelta=%" PRIu64 " leadTickDelta=%" PRIu64 "\n",
	        tEnd - tStart, tPlayStart - tStart);
	fprintf(out, "TIMING windowFrames=%d windowTickDelta=%" PRIu64
	        " ticksPerFrameMin=%" PRIu64 " minCount=%d ticksPerFrameMax=%" PRIu64 " maxCount=%d"
	        " ticksPerFrameRatio=%" PRIu64 "/%" PRIu64 "\n",
	        d->frames, d->sum, d->frames ? d->min : 0, d->minCount, d->max, d->maxCount, num / g, den / g);
	fprintf(out, "TIMING dsFirst=%u dsLast=%u dsChanges=%d firstDsChangeFrame=%d\n",
	        dsFirst, dsLast, dsChanges, firstDsChangeFrame);
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
#define FWDCAP 8
static int g_fwdN = 0;
static uint16_t g_fwdAddr[FWDCAP];
static int8_t g_fwdVal[FWDCAP];
static void fakeStore8(struct SM83Core* cpu, uint16_t a, int8_t v) {
	(void) cpu;
	if (g_fwdN < FWDCAP) { g_fwdAddr[g_fwdN] = a; g_fwdVal[g_fwdN] = v; }
	g_fwdN++;   /* count every forward; keep each value, not only the last */
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
	if (g_fwdN != 2 ||
	    g_fwdAddr[0] != 0xFF12 || g_fwdVal[0] != (int8_t) 0x88 ||
	    g_fwdAddr[1] != 0xFF80 || g_fwdVal[1] != (int8_t) 0x11) {
		fprintf(stderr, "SELFTEST FAIL hook forwarding\n"); ok = 0; }
	g_gb = NULL; g_store8 = NULL; g_n = 0;
	free(fake);
	return ok ? 0 : 1;
}

/* Timing accumulator invariants, independent of any emulator: sum, min/max with
 * tie counts, and the reduced ticks-per-frame rational. */
static int timingSelftest(void) {
	int ok = 1;
	struct TimingDiag d; diagInit(&d);
	uint64_t seq[] = { 70224, 70224, 70225, 70224, 70223 };
	for (int i = 0; i < 5; i++) diagAdd(&d, seq[i]);
	if (d.frames != 5 || d.sum != 351120ULL) { fprintf(stderr, "SELFTEST FAIL diag sum\n"); ok = 0; }
	if (d.min != 70223 || d.minCount != 1) { fprintf(stderr, "SELFTEST FAIL diag min\n"); ok = 0; }
	if (d.max != 70225 || d.maxCount != 1) { fprintf(stderr, "SELFTEST FAIL diag max\n"); ok = 0; }
	uint64_t g = gcd64(d.sum, (uint64_t) d.frames);
	if (d.sum / g != 70224 || (uint64_t) d.frames / g != 1) { fprintf(stderr, "SELFTEST FAIL diag rational\n"); ok = 0; }
	diagInit(&d); diagAdd(&d, 70224); diagAdd(&d, 70225);
	g = gcd64(d.sum, (uint64_t) d.frames);
	if (d.sum != 140449ULL || d.sum / g != 140449 || (uint64_t) d.frames / g != 2) {
		fprintf(stderr, "SELFTEST FAIL diag rational2\n"); ok = 0; }
	diagInit(&d); diagAdd(&d, 5); diagAdd(&d, 5); diagAdd(&d, 5);
	if (d.min != 5 || d.max != 5 || d.minCount != 3 || d.maxCount != 3) {
		fprintf(stderr, "SELFTEST FAIL diag equal counts\n"); ok = 0; }
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
		int r = recorderSelftest(), h = hookSelftest(), t = timingSelftest();
		if (r || h || t) return 1;
		printf("SELFTEST PASS: recorder order/monotonic/uint64/overflow, hook forward-both/filter/time, "
		       "and timing sum/min/max/rational\n");
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

	/* Observable timing calibration around the capture. We sample the raw global
	 * tick at the capture start, at the play-phase start, and after each play
	 * frame, WITHOUT assuming the double-speed flag tells us the tick unit. */
	uint64_t tCaptureStart = mTimingGlobalTime(&gb->timing);
	uint8_t dsFirst = (uint8_t) gb->doubleSpeed, dsPrev = dsFirst, dsLast = dsFirst;
	int dsChanges = 0, firstDsChangeFrame = -1;

	const uint32_t START = 1 << 3;   /* mGBA GB key order: A,B,Select,Start,... */
	/* Lead: hold START for 12 frames then release for 12; onset writes intact.
	 * The lead length is measured (leadFrames) so downstream need not hardcode 24. */
	for (int i = 0; i < 24; i++) {
		core->setKeys(core, i < 12 ? START : 0);
		core->runFrame(core);
		uint8_t ds = (uint8_t) gb->doubleSpeed;
		if (ds != dsPrev) { dsChanges++; if (firstDsChangeFrame < 0) firstDsChangeFrame = g_frame; dsPrev = ds; }
		dsLast = ds; g_frame++;
	}
	int leadFrames = g_frame;
	uint64_t tPlayStart = mTimingGlobalTime(&gb->timing);

	/* Stable window: the play phase takes no input, so per-frame tick deltas here
	 * are the calibration sample (>= 60 frames for the default/observer runs). */
	struct TimingDiag diag; diagInit(&diag);
	uint64_t prevTick = tPlayStart;
	for (long f = 0; f < playFrames; f++) {
		core->runFrame(core);
		uint64_t nowTick = mTimingGlobalTime(&gb->timing);
		diagAdd(&diag, nowTick - prevTick);
		prevTick = nowTick;
		uint8_t ds = (uint8_t) gb->doubleSpeed;
		if (ds != dsPrev) { dsChanges++; if (firstDsChangeFrame < 0) firstDsChangeFrame = g_frame; dsPrev = ds; }
		dsLast = ds; g_frame++;
	}
	uint64_t tCaptureEnd = mTimingGlobalTime(&gb->timing);

	gb->cpu->memory.store8 = g_store8;   /* restore before deinit */
	g_gb = NULL;

	printf("index,frame,time,doubleSpeed,reg,val\n");
	for (int i = 0; i < g_n; i++)
		printf("%d,%d,%" PRIu64 ",%u,FF%02X,%u\n",
		       i, g_ev[i].frame, g_ev[i].time, g_ev[i].ds, g_ev[i].reg, g_ev[i].val);

	diagReport(stderr, GBModelToName(gb->model), core->frequency(core), core->frameCycles(core),
	           leadFrames, playFrames, g_frame, tCaptureStart, tPlayStart, tCaptureEnd,
	           &diag, dsFirst, dsLast, dsChanges, firstDsChangeFrame);

	int overflow = g_overflow;
	if (overflow) fprintf(stderr, "CAPTURE_OVERFLOW at %d events; raise CAP\n", CAP);
	core->deinit(core); free(video);
	return overflow ? 3 : 0;
}
