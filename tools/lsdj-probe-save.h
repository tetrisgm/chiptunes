#ifndef CHIPTUNES_LSDJ_PROBE_SAVE_H
#define CHIPTUNES_LSDJ_PROBE_SAVE_H

#include <stdio.h>
#include <stdlib.h>
#include <mgba/core/core.h>
#include <mgba-util/vfs.h>

/* A measurement must not upgrade or otherwise rewrite its input fixture.
 * mCoreLoadSaveFile opens O_CREAT|O_RDWR, even in temporary mode. Give mGBA
 * an owned memory copy instead; all SRAM writes remain inside the process.
 * Explicit LSDJ_BOOT_SONG output in lsdjplay is a separate, exclusive file. */
static bool lsdjProbeLoadSave(struct mCore* core, const char* path) {
    FILE* input = fopen(path, "rb");
    if (!input) return false;
    if (fseek(input, 0, SEEK_END) != 0) { fclose(input); return false; }
    long length = ftell(input);
    if (length <= 0 || fseek(input, 0, SEEK_SET) != 0) {
        fclose(input); return false;
    }
    void* bytes = malloc((size_t) length);
    if (!bytes) { fclose(input); return false; }
    size_t read = fread(bytes, 1, (size_t) length, input);
    fclose(input);
    if (read != (size_t) length) { free(bytes); return false; }
    struct VFile* copy = VFileMemChunk(bytes, (size_t) length);
    free(bytes);
    if (!copy) return false;
    if (!core->loadSave(core, copy)) { copy->close(copy); return false; }
    return true; /* core owns copy until deinit */
}

#endif
