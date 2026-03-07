#include "ace_engine.h"

/**
 * Detect whether an audio file was transcoded from a lossy source.
 *
 * Approach:
 *   1. Run FFT across full file, look for spectral cutoff (e.g. 16/18/20 kHz)
 *      that is characteristic of MP3/AAC/Vorbis encoding.
 *   2. Examine noise floor profile for quantisation patterns.
 *   3. Check metadata codec chain if available (e.g. ID3 TENC tag).
 *
 * Returns 1 if lossy transcoding is suspected, 0 otherwise.
 */
int ace_detect_lossy_transcode(const char* file_path);
// TODO: implement using codec fingerprinting
