// WASM wrapper around libvgm's PlayerA — render raw VGM bytes to int16 stereo PCM.
// Exposes a small C API for Retro Rave Radio, including per-chip-channel stem mixing.
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <algorithm>
#include <vector>
#include "player/playerbase.hpp"
#include "player/vgmplayer.hpp"
#include "player/playera.hpp"
#include "emu/SoundDevs.h"
#include "utils/DataLoader.h"
#include "utils/MemoryLoader.h"

#define BUFLEN 2048    // PlayerA::Render fills at most this many frames per call -> we loop to fill any request

#define STEM_COUNT 16

struct StemPlayer {
    PlayerA*     player = nullptr;
    VGMPlayer*   engine = nullptr;   // owned by PlayerA after RegisterPlayerEngine()
    DATA_LOADER* loader = nullptr;
    float        gain   = 1.0f;
    bool         active = false;
};

static StemPlayer g_stems[STEM_COUNT];
static StemPlayer g_full;
static uint8_t*   g_data       = nullptr;
static uint32_t   g_dataLen    = 0;
static uint32_t   g_sampleRate = 44100;
static std::vector<int32_t> g_tmp32;
static std::vector<int64_t> g_mix;
static bool g_customMix = false;
static float g_pbSpeed = 1.0f;
static float g_stemStats[STEM_COUNT * 4];   // per stem: rms, peak, zero-cross pitch Hz, active

static uint32_t maskForCount(uint16_t count) {
    if (count >= 32) return 0xFFFFFFFFu;
    return count ? ((1u << count) - 1u) : 0u;
}

static int stemForChannel(uint32_t type, uint32_t ch, uint32_t parentType) {
    switch (type) {
        case DEVID_NES_APU:      // Square 1, Square 2, Triangle, Noise, DPCM, FDS
            return (ch < 6) ? (int)ch : 15;
        case DEVID_GB_DMG:       // Square 1, Square 2, Wave, Noise
            return (ch < 4) ? (int)ch : 15;
        case DEVID_SN76496:      // Standalone PSG/T6W28, or Genesis PSG as a child of YM2612
            if (parentType == DEVID_YM2612) return (ch < 4) ? (int)(6 + ch) : 9;
            return (ch < 8) ? (int)ch : 7;
        case DEVID_AY8910:       // Standalone AY/SSG, or Neo Geo SSG as a child of YM2610
            if (parentType == DEVID_YM2610 || parentType == DEVID_YM2608) return (ch < 3) ? (int)(13 + ch) : 15;
            return (ch < 4) ? (int)ch : 3;
        case DEVID_YM2612:       // FM 1..6, DAC
            return (ch < 6) ? (int)ch : 10;
        case DEVID_C6280:        // six PSG voices
            return (ch < 6) ? (int)ch : 15;
        case DEVID_YM2610:       // Neo Geo: 6 FM + 6 ADPCM-A + ADPCM-B
        case DEVID_YM2608:
            if (ch < 13) return (int)ch;
            return 12;
        case DEVID_MSM6295:
        case DEVID_uPD7759:
        case DEVID_MSM6258:
        case DEVID_MSM5205:
        case DEVID_K053260:
        case DEVID_C140:
        case DEVID_C219:
        case DEVID_SEGAPCM:
            return (ch < 16) ? (int)ch : 15;
        default:
            return (ch < 16) ? (int)ch : 15;
    }
}

static void destroyStem(StemPlayer& stem) {
    if (stem.player) {
        stem.player->Stop();
        stem.player->UnloadFile();
        stem.player->UnregisterAllPlayers();
        delete stem.player;
    }
    if (stem.loader) DataLoader_Deinit(stem.loader);
    stem.player = nullptr;
    stem.engine = nullptr;
    stem.loader = nullptr;
    stem.active = false;
}

static void applyStemMute(StemPlayer& stem, int stemIndex) {
    if (!stem.engine) return;
    std::vector<PLR_DEV_INFO> devs;
    if (stem.engine->GetSongDeviceInfo(devs) >= 0x80) return;

    bool hasAny = false;
    for (size_t i = 0; i < devs.size(); i++) {
        if (devs[i].parentIdx != (uint32_t)-1) continue;

        PLR_MUTE_OPTS mute;
        memset(&mute, 0, sizeof(mute));
        uint32_t all[2] = {0, 0};
        uint32_t keep[2] = {0, 0};

        const PLR_DEV_INFO& main = devs[i];
        uint16_t chn = main.devDecl ? main.devDecl->channelCount(main.devCfg) : 0;
        all[0] = maskForCount(chn);
        for (uint32_t ch = 0; ch < chn && ch < 32; ch++) {
            if (stemForChannel(main.type, ch, (uint32_t)-1) == stemIndex) keep[0] |= (1u << ch);
        }

        for (size_t j = 0; j < devs.size(); j++) {
            if (devs[j].parentIdx != i) continue;
            uint32_t link = devs[j].instance;
            if (link > 1) continue;
            uint16_t lchn = devs[j].devDecl ? devs[j].devDecl->channelCount(devs[j].devCfg) : 0;
            all[link] = maskForCount(lchn);
            for (uint32_t ch = 0; ch < lchn && ch < 32; ch++) {
                if (stemForChannel(devs[j].type, ch, main.type) == stemIndex) keep[link] |= (1u << ch);
            }
        }

        if (keep[0] || keep[1]) hasAny = true;
        mute.chnMute[0] = all[0] & ~keep[0];
        mute.chnMute[1] = all[1] & ~keep[1];
        uint32_t instance = (main.instance == 0xFFFF) ? 0 : main.instance;
        stem.engine->SetDeviceMuting(PLR_DEV_ID(main.type, instance), mute);
    }
    stem.active = hasAny;
}

static float clampSpeed(float speed) {
    if (speed < 0.25f) return 0.25f;
    if (speed > 4.0f) return 4.0f;
    return speed;
}

static void applySpeed(StemPlayer& stem) {
    if (!stem.player) return;
    PlayerA::Config cfg = stem.player->GetConfiguration();
    cfg.pbSpeed = g_pbSpeed;
    stem.player->SetConfiguration(cfg);
}

static int initStem(StemPlayer& stem, int stemIndex) {
    stem.player = new PlayerA();
    if (!stem.player) return 1;
    stem.engine = new VGMPlayer();
    if (!stem.engine) return 2;
    stem.player->RegisterPlayerEngine(stem.engine);
    if (stem.player->SetOutputSettings(g_sampleRate, 2, 32, BUFLEN)) return 3;

    PlayerA::Config cfg = stem.player->GetConfiguration();
    cfg.masterVol       = 0x10000;
    cfg.loopCount       = 2;
    cfg.fadeSmpls       = g_sampleRate * 4;
    cfg.endSilenceSmpls = g_sampleRate / 2;
    cfg.pbSpeed         = g_pbSpeed;
    stem.player->SetConfiguration(cfg);

    stem.loader = MemoryLoader_Init(g_data, g_dataLen);
    if (!stem.loader) return 4;
    DataLoader_SetPreloadBytes(stem.loader, 0x100);
    if (DataLoader_Load(stem.loader)) return 5;
    if (stem.player->LoadFile(stem.loader)) return 6;
    if (stemIndex >= 0) applyStemMute(stem, stemIndex);
    else stem.active = true;
    if (!stem.active) return 0;
    stem.player->Start();
    return 0;
}

static int initAnalysisStem(StemPlayer& stem, const uint8_t* data, uint32_t len, uint32_t sampleRate) {
    stem.player = new PlayerA();
    if (!stem.player) return 1;
    stem.engine = new VGMPlayer();
    if (!stem.engine) return 2;
    stem.player->RegisterPlayerEngine(stem.engine);
    if (stem.player->SetOutputSettings(sampleRate ? sampleRate : 44100, 2, 32, BUFLEN)) return 3;

    PlayerA::Config cfg = stem.player->GetConfiguration();
    cfg.masterVol       = 0x10000;
    cfg.loopCount       = 1;
    cfg.fadeSmpls       = (sampleRate ? sampleRate : 44100) * 2;
    cfg.endSilenceSmpls = (sampleRate ? sampleRate : 44100) / 2;
    cfg.pbSpeed         = 1.0f;
    stem.player->SetConfiguration(cfg);

    stem.loader = MemoryLoader_Init((uint8_t*)data, len);
    if (!stem.loader) return 4;
    DataLoader_SetPreloadBytes(stem.loader, 0x100);
    if (DataLoader_Load(stem.loader)) return 5;
    if (stem.player->LoadFile(stem.loader)) return 6;
    stem.active = true;
    stem.player->Start();
    return 0;
}

static uint32_t normalizeAnalysisBpm(float bpm) {
    if (!(bpm > 0.0f) || !isfinite(bpm)) return 0;
    while (bpm < 82.0f && bpm * 2.0f <= 220.0f) bpm *= 2.0f;
    while (bpm > 188.0f && bpm / 2.0f >= 55.0f) bpm /= 2.0f;
    if (bpm < 55.0f || bpm > 220.0f) return 0;
    return (uint32_t)(bpm + 0.5f);
}

static uint32_t bpmFromEnvelope(const std::vector<float>& env, float blockDur) {
    size_t n = env.size();
    if (n < 32 || !(blockDur > 0.0f)) return 0;

    std::vector<float> smooth(n, 0.0f), flux(n, 0.0f);
    float maxEnv = 0.0f, sm = 0.0f;
    for (size_t i = 0; i < n; i++) {
        sm = sm * 0.62f + env[i] * 0.38f;
        smooth[i] = sm;
        if (sm > maxEnv) maxEnv = sm;
    }
    if (maxEnv < 0.0025f) return 0;

    double mean = 0.0;
    uint32_t count = 0;
    for (size_t i = 1; i < n; i++) {
        float d = smooth[i] - smooth[i - 1];
        if (d < 0.0f) d = 0.0f;
        if (smooth[i] < maxEnv * 0.045f) d *= 0.35f;
        flux[i] = d;
        mean += d;
        count++;
    }
    if (!count) return 0;
    mean /= (double)count;

    double bestScore = 0.0;
    uint32_t bestLag = 0;
    uint32_t minLag = std::max<uint32_t>(2, (uint32_t)(60.0f / (220.0f * blockDur) + 0.5f));
    uint32_t maxLag = std::min<uint32_t>((uint32_t)n / 2, (uint32_t)(60.0f / (55.0f * blockDur) + 0.5f));
    for (uint32_t lag = minLag; lag <= maxLag; lag++) {
        double score = 0.0, normA = 0.0, normB = 0.0;
        for (size_t i = lag; i < n; i++) {
            double a = std::max(0.0, (double)flux[i] - mean * 0.35);
            double b = std::max(0.0, (double)flux[i - lag] - mean * 0.35);
            score += a * b;
            normA += a * a;
            normB += b * b;
        }
        if (normA <= 0.0 || normB <= 0.0) continue;
        score /= sqrt(normA * normB);
        float bpm = 60.0f / ((float)lag * blockDur);
        if (bpm < 70.0f) score *= 0.94;   // prefer the musical quarter pulse over very slow half-time aliases
        if (bpm > 180.0f) score *= 0.96;
        if (score > bestScore) { bestScore = score; bestLag = lag; }
    }
    if (!bestLag || bestScore < 0.055) return 0;
    return normalizeAnalysisBpm(60.0f / ((float)bestLag * blockDur));
}

static int16_t clamp16(int32_t v) {
    if (v < -32768) return -32768;
    if (v > 32767) return 32767;
    return (int16_t)v;
}

static bool wantsCustomMix(void) {
    for (int i = 0; i < STEM_COUNT; i++) {
        if (g_stems[i].active && (g_stems[i].gain < 0.999f || g_stems[i].gain > 1.001f)) return true;
    }
    return false;
}

static StemPlayer* firstActiveStem(void) {
    for (int i = 0; i < STEM_COUNT; i++) {
        if (g_stems[i].active && g_stems[i].player) return &g_stems[i];
    }
    return nullptr;
}

static void seekStemTo(StemPlayer& stem, uint32_t samplePos) {
    if (stem.active && stem.player) stem.player->Seek(PLAYPOS_SAMPLE, samplePos);
}

static void syncRenderMode(bool custom) {
    if (custom == g_customMix) return;
    if (custom) {
        uint32_t pos = (g_full.player ? g_full.player->GetCurPos(PLAYPOS_SAMPLE) : 0);
        for (int i = 0; i < STEM_COUNT; i++) seekStemTo(g_stems[i], pos);
    } else {
        StemPlayer* s = firstActiveStem();
        uint32_t pos = (s && s->player) ? s->player->GetCurPos(PLAYPOS_SAMPLE) : 0;
        seekStemTo(g_full, pos);
    }
    g_customMix = custom;
}

static int16_t packTo16(int64_t v) {
    v >>= 16;   // PlayerA S32 pack stores its 24-bit internal sample shifted left by 8.
    if (v < -32768) return -32768;
    if (v > 32767) return 32767;
    return (int16_t)v;
}

extern "C" {

void vgm_free(void) {
    destroyStem(g_full);
    for (int i = 0; i < STEM_COUNT; i++) destroyStem(g_stems[i]);
	    if (g_data)   { free(g_data); g_data = nullptr; }
	    g_dataLen = 0;
	    g_customMix = false;
	    memset(g_stemStats, 0, sizeof(g_stemStats));
	}

// load raw VGM bytes; returns 0 on success, nonzero error code otherwise
int vgm_load(const uint8_t* data, uint32_t len, uint32_t sampleRate) {
    vgm_free();
    g_sampleRate = sampleRate ? sampleRate : 44100;
    g_data = (uint8_t*)malloc(len);
    if (!g_data) return 1;
    g_dataLen = len;
    memcpy(g_data, data, len);

    int fullErr = initStem(g_full, -1);
    if (fullErr) { vgm_free(); return 7 + fullErr; }

    bool any = false;
    for (int role = 0; role < STEM_COUNT; role++) {
        int err = initStem(g_stems[role], role);
        if (err) { vgm_free(); return 10 + role * 10 + err; }
        if (g_stems[role].active) any = true;
    }
    if (!any) { vgm_free(); return 6; }
    return 0;
}

void vgm_set_stem_gain(uint32_t stem, float gain) {
    if (stem >= STEM_COUNT) return;
    if (gain < 0.0f) gain = 0.0f;
    if (gain > 3.0f) gain = 3.0f;
    g_stems[stem].gain = gain;
}

void vgm_set_tempo(float speed) {
    g_pbSpeed = clampSpeed(speed);
    applySpeed(g_full);
    for (int i = 0; i < STEM_COUNT; i++) applySpeed(g_stems[i]);
}

void vgm_seek_samples(uint32_t samplePos) {
    seekStemTo(g_full, samplePos);
    for (int i = 0; i < STEM_COUNT; i++) seekStemTo(g_stems[i], samplePos);
}

uint32_t vgm_active_stems(void) {
    uint32_t mask = 0;
    for (int i = 0; i < STEM_COUNT && i < 32; i++) {
        if (g_stems[i].active) mask |= (1u << i);
    }
    return mask;
}

uint32_t vgm_analyze_bpm(const uint8_t* data, uint32_t len, uint32_t sampleRate, uint32_t seconds) {
    if (!data || len < 0x40) return 0;
    uint32_t sr = sampleRate ? sampleRate : 44100;
    uint32_t sec = seconds ? seconds : 22;
    if (sec < 8) sec = 8;
    if (sec > 45) sec = 45;

    StemPlayer scratch;
    int err = initAnalysisStem(scratch, data, len, sr);
    if (err) { destroyStem(scratch); return 0; }

    const uint32_t blockFrames = 1024;
    uint32_t totalFrames = sr * sec;
    uint32_t blocks = totalFrames / blockFrames;
    if (blocks < 32) blocks = 32;
    std::vector<int32_t> buf(blockFrames * 2, 0);
    std::vector<float> env;
    env.reserve(blocks);

    for (uint32_t b = 0; b < blocks; b++) {
        memset(buf.data(), 0, buf.size() * sizeof(int32_t));
        scratch.player->Render(blockFrames * 2 * (uint32_t)sizeof(int32_t), buf.data());
        double sum = 0.0;
        float peak = 0.0f;
        for (uint32_t i = 0; i < blockFrames; i++) {
            int32_t mono = (buf[i * 2] / 2) + (buf[i * 2 + 1] / 2);
            int32_t s16 = mono >> 16;
            float v = (float)s16 / 32768.0f;
            float av = v < 0.0f ? -v : v;
            sum += (double)v * (double)v;
            if (av > peak) peak = av;
        }
        float rms = (float)sqrt(sum / (double)blockFrames);
        env.push_back(rms * 0.78f + peak * 0.22f);
        if (scratch.player->GetState() & PLAYSTATE_FIN) break;
    }

    destroyStem(scratch);
    return bpmFromEnvelope(env, (float)blockFrames / (float)sr);
}

// render `frames` stereo frames into out (out must hold frames*2 int16); returns frames rendered.
// PlayerA::Render caps at the configured buffer (BUFLEN) per call, so loop until the whole request is filled
// (a single big Render left the tail of each audio quantum stale -> choppy on every platform).
int vgm_render(int16_t* out, uint32_t frames) {
    if (!g_data) { memset(out, 0, frames * 2 * sizeof(int16_t)); return 0; }
    // Use libvgm's native full mix at default channel levels for best playback quality.
    // Isolated stems still render below for semantic analysis; they only become audible when a channel gain changes.
    syncRenderMode(wantsCustomMix());
    double sumSq[STEM_COUNT];
    float peak[STEM_COUNT];
    uint32_t crossings[STEM_COUNT];
    uint32_t samples[STEM_COUNT];
    int prevSign[STEM_COUNT];
    memset(g_stemStats, 0, sizeof(g_stemStats));
    memset(sumSq, 0, sizeof(sumSq));
    memset(peak, 0, sizeof(peak));
    memset(crossings, 0, sizeof(crossings));
    memset(samples, 0, sizeof(samples));
    memset(prevSign, 0, sizeof(prevSign));
    uint32_t done = 0;
    while (done < frames) {
        uint32_t chunk = frames - done;
        if (chunk > BUFLEN) chunk = BUFLEN;

        if (!g_customMix) {
            g_tmp32.assign(chunk * 2, 0);
            if (g_full.player) g_full.player->Render(chunk * 2 * (uint32_t)sizeof(int32_t), g_tmp32.data());
            for (uint32_t i = 0; i < chunk * 2; i++) out[done * 2 + i] = packTo16(g_tmp32[i]);

            for (int role = 0; role < STEM_COUNT; role++) {
                StemPlayer& stem = g_stems[role];
                if (!stem.active || !stem.player) continue;
                memset(g_tmp32.data(), 0, chunk * 2 * sizeof(int32_t));
                stem.player->Render(chunk * 2 * (uint32_t)sizeof(int32_t), g_tmp32.data());
                for (uint32_t s = 0; s < chunk; s++) {
                    int32_t mono = (g_tmp32[s * 2] / 2) + (g_tmp32[s * 2 + 1] / 2);
                    int32_t s16 = mono >> 16;
                    float v = (float)s16 / 32768.0f;
                    float av = v < 0 ? -v : v;
                    sumSq[role] += (double)v * (double)v;
                    if (av > peak[role]) peak[role] = av;
                    int sign = (s16 > 220) ? 1 : (s16 < -220 ? -1 : 0);
                    if (sign && prevSign[role] && sign != prevSign[role]) crossings[role]++;
                    if (sign) prevSign[role] = sign;
                    samples[role]++;
                }
            }
            done += chunk;
            continue;
        }

        g_mix.assign(chunk * 2, 0);
        g_tmp32.assign(chunk * 2, 0);

        for (int role = 0; role < STEM_COUNT; role++) {
            StemPlayer& stem = g_stems[role];
            if (!stem.active || !stem.player) continue;
            memset(g_tmp32.data(), 0, chunk * 2 * sizeof(int32_t));
            stem.player->Render(chunk * 2 * (uint32_t)sizeof(int32_t), g_tmp32.data());
            for (uint32_t s = 0; s < chunk; s++) {
                int32_t mono = (g_tmp32[s * 2] / 2) + (g_tmp32[s * 2 + 1] / 2);
                int32_t s16 = mono >> 16;
                float v = (float)s16 / 32768.0f;
                float av = v < 0 ? -v : v;
                sumSq[role] += (double)v * (double)v;
                if (av > peak[role]) peak[role] = av;
                int sign = (s16 > 220) ? 1 : (s16 < -220 ? -1 : 0);
                if (sign && prevSign[role] && sign != prevSign[role]) crossings[role]++;
                if (sign) prevSign[role] = sign;
                samples[role]++;
            }
            if (stem.gain <= 0.0001f) continue;   // still render above so muted stems stay in sync if unmuted later
            for (uint32_t i = 0; i < chunk * 2; i++) {
                g_mix[i] += (int64_t)(g_tmp32[i] * stem.gain);
            }
        }

        for (uint32_t i = 0; i < chunk * 2; i++) out[done * 2 + i] = packTo16(g_mix[i]);
        done += chunk;
    }
    for (int role = 0; role < STEM_COUNT; role++) {
        uint32_t n = samples[role];
        float rms = n ? (float)sqrt(sumSq[role] / (double)n) : 0.0f;
        float hz = (n && crossings[role] > 1) ? ((float)crossings[role] * (float)g_sampleRate / (2.0f * (float)n)) : 0.0f;
        g_stemStats[role * 4 + 0] = rms;
        g_stemStats[role * 4 + 1] = peak[role];
        g_stemStats[role * 4 + 2] = hz;
        g_stemStats[role * 4 + 3] = g_stems[role].active ? 1.0f : 0.0f;
    }
    return (int)frames;
}

uint32_t vgm_stem_stats(float* out, uint32_t maxFloats) {
    uint32_t n = STEM_COUNT * 4;
    if (!out) return n;
    if (maxFloats < n) n = maxFloats;
    for (uint32_t i = 0; i < n; i++) out[i] = g_stemStats[i];
    return n;
}

// 1 once the track has finished (file end + fade + trailing silence)
int vgm_ended(void) {
    if (!g_customMix && g_full.active && g_full.player)
        return (g_full.player->GetState() & PLAYSTATE_FIN) ? 1 : 0;
    for (int i = 0; i < STEM_COUNT; i++) {
        if (g_stems[i].active && g_stems[i].player)
            return (g_stems[i].player->GetState() & PLAYSTATE_FIN) ? 1 : 0;
    }
    return 1;
}

}
