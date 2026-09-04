#include <stdio.h>
#include <string.h>
#include "lsdj/project.h"
#include "lsdj/song.h"
#include "lsdj/phrase.h"
#include "lsdj/chain.h"
#include "lsdj/instrument.h"
int main(int argc, char** argv) {
  lsdj_project_t* p = NULL;
  size_t n = 0;
  lsdj_error_t e = lsdj_project_read_lsdsng_from_file(argv[1], &p, NULL);
  if (e != LSDJ_SUCCESS) { printf("READ_FAILED %d\n", e); return 1; }
  const char* name = lsdj_project_get_name(p);
  const lsdj_song_t* s = lsdj_project_get_song_const(p);
  printf("name=%s version=%d tempo=%d\n", name, lsdj_project_get_version(p), lsdj_song_get_tempo((lsdj_song_t*)s));
  int seqrows = 0;
  for (int r = 0; r < 256; r++)
    for (int c = 0; c < 4; c++)
      if (lsdj_row_get_chain(s, r, (lsdj_channel_t)c) != LSDJ_SONG_NO_CHAIN) { seqrows++; break; }
  printf("sequence cells used=%d\n", seqrows);
  int phrases = 0, notes = 0;
  for (int i = 0; i < 255; i++) if (lsdj_phrase_is_allocated(s, i)) { phrases++;
    for (int st = 0; st < 16; st++) if (lsdj_phrase_get_note(s, i, st) != LSDJ_PHRASE_NO_NOTE) notes++; }
  int chains = 0;
  for (int i = 0; i < 128; i++) if (lsdj_chain_is_allocated(s, i)) chains++;
  int insts = 0;
  for (int i = 0; i < 64; i++) if (lsdj_instrument_is_allocated(s, i)) insts++;
  printf("phrases=%d chains=%d notes=%d instruments=%d\n", phrases, chains, notes, insts);
  for (int i = 0; i < 4 && i < 255; i++) if (lsdj_phrase_is_allocated(s, i)) {
    printf("phrase %d:", i);
    for (int st = 0; st < 16; st++) printf(" %d", lsdj_phrase_get_note(s, i, st));
    printf("\n");
  }
  return 0;
}
