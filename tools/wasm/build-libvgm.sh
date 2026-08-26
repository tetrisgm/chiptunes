#!/bin/zsh
# Rebuild dist/lib/libvgm.{js,wasm} — the full multi-chip VGM player (ValleyBell libvgm) compiled to WASM.
# Renders raw .vgm bytes -> int16 stereo PCM for the chip-music stations (NES/GB/Genesis/TG16/NeoGeo/NGP).
# Needs emscripten (~/emsdk) + the libvgm source at /tmp/libvgm (re-clone if missing). Wrapper: tools/wasm/vgm_wasm.cpp
set -e
HERE=${0:A:h}          # tools/wasm/
ROOT=${HERE:h:h}       # repo root
SRC=/tmp/libvgm
[ -d "$SRC" ] || git clone --depth 1 https://github.com/ValleyBell/libvgm.git "$SRC"
cp "$HERE/vgm_wasm.cpp" "$SRC/vgm_wasm.cpp"   # use the version-controlled wrapper
source ~/emsdk/emsdk_env.sh >/dev/null 2>&1
cd "$SRC"
embuilder build zlib >/dev/null 2>&1 || true
emcmake cmake -B build-wasm \
  -DBUILD_LIBAUDIO=OFF -DBUILD_PLAYER=OFF -DBUILD_VGM2WAV=OFF -DBUILD_TESTS=OFF \
  -DBUILD_LIBEMU=ON -DBUILD_LIBPLAYER=ON -DUTIL_CHARCNV_ICONV=ON -DUSE_SANITIZERS=OFF \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS="-sUSE_ZLIB=1" -DCMAKE_CXX_FLAGS="-sUSE_ZLIB=1" >/dev/null
emmake make -C build-wasm -j8 2>&1 | tail -2
emcc vgm_wasm.cpp \
  build-wasm/bin/libvgm-player.a build-wasm/bin/libvgm-emu.a build-wasm/bin/libvgm-utils.a \
  -I"$SRC" -O3 -sUSE_ZLIB=1 \
  -sMODULARIZE=1 -sEXPORT_NAME=createLibVgm -sENVIRONMENT=web -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS=_vgm_load,_vgm_render,_vgm_ended,_vgm_free,_vgm_set_stem_gain,_vgm_set_tempo,_vgm_seek_samples,_vgm_stem_stats,_vgm_active_stems,_vgm_analyze_bpm,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=ccall,HEAP16,HEAPU8,HEAPF32 \
  -o "$ROOT/dist/lib/libvgm.js"
echo "built dist/lib/libvgm.{js,wasm}: $(ls -la "$ROOT/dist/lib/libvgm.wasm" | awk '{print $5}') bytes wasm"
