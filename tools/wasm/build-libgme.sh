#!/bin/zsh
# Rebuild dist/lib/libgme.{js,wasm} — Game_Music_Emu compiled to WASM for SPC/SNES playback.
# Exports the voice APIs used by the SNES mixer (8 S-DSP voices).
set -e
HERE=${0:A:h}          # tools/wasm/
ROOT=${HERE:h:h}       # repo root
SRC=/tmp/gme
[ -d "$SRC" ] || git clone --depth 1 https://github.com/libgme/game-music-emu.git "$SRC"
source ~/emsdk/emsdk_env.sh >/dev/null 2>&1
cd "$SRC"
emcmake cmake -B build-wasm \
  -DCMAKE_BUILD_TYPE=Release \
  -DGME_BUILD_SHARED=OFF -DGME_BUILD_STATIC=ON -DGME_BUILD_EXAMPLES=OFF -DGME_BUILD_TESTING=OFF -DGME_ZLIB=OFF \
  -DUSE_GME_AY=OFF -DUSE_GME_GBS=OFF -DUSE_GME_GYM=OFF -DUSE_GME_HES=OFF -DUSE_GME_KSS=OFF \
  -DUSE_GME_NSF=OFF -DUSE_GME_NSFE=OFF -DUSE_GME_SAP=OFF -DUSE_GME_VGM=OFF -DUSE_GME_SPC=ON >/dev/null
emmake make -C build-wasm -j8 gme_static 2>&1 | tail -2
LIB=$(find build-wasm -name 'libgme*.a' -print -quit)
[ -n "$LIB" ] || { echo "libgme archive not found" >&2; exit 1; }
emcc "$LIB" \
  -I"$SRC/gme" -O3 \
  -sMODULARIZE=1 -sEXPORT_NAME=createLibGme -sENVIRONMENT=web -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS=_gme_open_data,_gme_delete,_gme_track_count,_gme_start_track,_gme_play,_gme_set_fade,_gme_track_ended,_gme_set_tempo,_gme_voice_count,_gme_voice_name,_gme_mute_voice,_gme_mute_voices,_gme_seek_samples,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,setValue,getValue,HEAP16,HEAPU8 \
  -o "$ROOT/dist/lib/libgme.js"
echo "built dist/lib/libgme.{js,wasm}: $(ls -la "$ROOT/dist/lib/libgme.wasm" | awk '{print $5}') bytes wasm"
