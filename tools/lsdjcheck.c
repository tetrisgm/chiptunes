/* An INDEPENDENT reader for what src/lsdj.js writes.
 *
 * scripts/verify-lsdj.js shells out to this. The point is that it is not our
 * code: it links liblsdj (MIT, Stijn Frishert with Johan Kotlinski) and reports
 * what THAT library sees, so the export is never graded by its own homework.
 * A self round-trip -- our compressor feeding our decompressor -- would repeat
 * the mistake that once let a WebMCP registration ship against the wrong API,
 * where the code and its test agreed with each other and were both wrong.
 *
 * Build:
 *   git clone --depth 1 https://github.com/stijnfrishert/liblsdj
 *   clang -Iliblsdj/liblsdj/include -Iliblsdj/liblsdj/include/lsdj \
 *         -o /tmp/lsdjcheck tools/lsdjcheck.c liblsdj/liblsdj/src/*.c
 *
 * Usage: lsdjcheck FILE.lsdsng | lsdjcheck FILE.sav
 */
#include <stdio.h>
#include <string.h>
#include "lsdj/project.h"
#include "lsdj/sav.h"
#include "lsdj/song.h"
#include "lsdj/phrase.h"
#include "lsdj/chain.h"
#include "lsdj/instrument.h"

static void report_song(const lsdj_song_t* s) {
  int seq = 0;
  for (int r = 0; r < 256; r++)
    for (int c = 0; c < 4; c++)
      if (lsdj_row_get_chain(s, r, (lsdj_channel_t)c) != LSDJ_SONG_NO_CHAIN) { seq++; break; }
  printf("sequence cells used=%d\n", seq);
  int phrases = 0, notes = 0, chains = 0, insts = 0;
  for (int i = 0; i < 255; i++)
    if (lsdj_phrase_is_allocated(s, i)) {
      phrases++;
      for (int st = 0; st < 16; st++)
        if (lsdj_phrase_get_note(s, i, st) != LSDJ_PHRASE_NO_NOTE) notes++;
    }
  for (int i = 0; i < 128; i++) if (lsdj_chain_is_allocated(s, i)) chains++;
  for (int i = 0; i < 64; i++) if (lsdj_instrument_is_allocated(s, i)) insts++;
  printf("phrases=%d chains=%d notes=%d instruments=%d\n", phrases, chains, notes, insts);
}

int main(int argc, char** argv) {
  if (argc < 2) { printf("usage: lsdjcheck FILE.lsdsng|FILE.sav\n"); return 2; }
  const char* path = argv[1];
  const char* dot = strrchr(path, '.');
  int isSav = dot && strcmp(dot, ".sav") == 0;

  if (isSav) {
    lsdj_sav_t* sav = NULL;
    if (lsdj_sav_read_from_file(path, &sav, NULL) != LSDJ_SUCCESS) { printf("SAV_READ_FAILED\n"); return 1; }
    int used = 0;
    for (int i = 0; i < LSDJ_SAV_PROJECT_COUNT; i++) {
      const lsdj_project_t* p = lsdj_sav_get_project_const(sav, i);
      if (!p) continue;
      used++;
      printf("slot %2d  %-9s tempo=%d\n", i, lsdj_project_get_name(p),
             lsdj_song_get_tempo((lsdj_song_t*)lsdj_project_get_song_const(p)));
    }
    printf("projects=%d active=%d\n", used, lsdj_sav_get_active_project_index(sav));
    /* the first slot in full, so the gate can compare counts */
    const lsdj_project_t* first = lsdj_sav_get_project_const(sav, 0);
    if (first) report_song(lsdj_project_get_song_const(first));
    return 0;
  }

  lsdj_project_t* p = NULL;
  if (lsdj_project_read_lsdsng_from_file(path, &p, NULL) != LSDJ_SUCCESS) { printf("READ_FAILED\n"); return 1; }
  const lsdj_song_t* s = lsdj_project_get_song_const(p);
  printf("name=%s version=%d tempo=%d\n", lsdj_project_get_name(p),
         lsdj_project_get_version(p), lsdj_song_get_tempo((lsdj_song_t*)s));
  report_song(s);
  for (int i = 0; i < 4 && i < 255; i++)
    if (lsdj_phrase_is_allocated(s, i)) {
      printf("phrase %d:", i);
      for (int st = 0; st < 16; st++) printf(" %d", lsdj_phrase_get_note(s, i, st));
      printf("\n");
    }
  return 0;
}
