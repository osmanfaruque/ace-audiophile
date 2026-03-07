#include "ace_engine.h"

/**
 * Detect whether a high-bit-depth file actually contains audio with
 * meaningful information above what 16-bit could represent.
 *
 * Strategy:
 *   1. Compute histogram of least-significant bits of each sample after
 *      normalising to 24-bit integer representation.
 *   2. If the low 8 bits are essentially zero (< noise floor) the file is
 *      padded — true bit depth ≈ 16.
 *   3. Uses a chi-squared test against a flat distribution to confirm.
 *
 * Returns the estimated effective bit depth (16, 20, or 24).
 */
int ace_detect_effective_bit_depth(const float* pcm, int frames, int channels, int declared_bits);
// TODO: implement
