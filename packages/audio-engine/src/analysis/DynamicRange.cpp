#include "ace_engine.h"

/**
 * EBU R128 / DR Meter implementation.
 *
 * Provides:
 *   - Integrated loudness (LUFS)
 *   - Loudness range (LRA)
 *   - True peak (dBTP)
 *   - Dynamic range score (DR, compatible with Dynamic Range Database)
 */

typedef struct AceDRResult {
    float lufs_integrated;
    float loudness_range;
    float true_peak_dbtp;
    float dr_score;
} AceDRResult;

/** Analyse a decoded PCM buffer.  Incremental — call multiple times then finish(). */
void ace_dr_push(const float* pcm, int frames, int channels, int sample_rate);
void ace_dr_finish(AceDRResult* out);
void ace_dr_reset(void);
// TODO: implement EBU R128 using ITU-R BS.1770-4 K-weighting filter + gating
