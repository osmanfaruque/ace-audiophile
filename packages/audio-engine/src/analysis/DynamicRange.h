#pragma once
#include <cstdint>

/**
 * DynamicRange — EBU R128 LUFS + DR analysis module (A7.2.1).
 *
 * Implements ITU-R BS.1770-4 K-weighted loudness measurement with:
 *   - Pre-filter: high-shelf (+4 dB @ 1681 Hz) + high-pass (38.1 Hz)
 *   - 400 ms sliding window with 100 ms hop
 *   - Absolute gating at −70 LKFS
 *   - Relative gating at L_abs − 10 dB
 *
 * Also computes:
 *   - Dynamic range as crest factor (peak/RMS ratio in dB)
 *   - True peak via 4× sinc-interpolation oversampling (A7.2.2)
 *   - DC offset as mean of all samples (A7.2.5)
 *   - Clipping detection via consecutive full-scale runs (A7.2.6)
 */
class DynamicRange {
public:
    struct Result {
        float    lufs_integrated;   ///< EBU R128 integrated loudness (LKFS)
        float    dynamic_range_db;  ///< Crest factor DR (dB)
        float    true_peak_dbtp;    ///< 4× oversampled true peak (dBTP)
        float    dc_offset;         ///< Mean of all samples (ideal = 0.0)
        uint64_t clipping_count;    ///< Number of consecutive full-scale sample runs
        float    clipping_max_run;  ///< Length of longest clipping run (samples)
    };

    /**
     * Analyse a file for loudness, DR, true peak, DC offset, and clipping.
     * @param path        Path to the audio file.
     * @param out         Output result structure.
     * @param progress_cb Optional progress callback (0.0–1.0).
     * @param userdata    Opaque pointer forwarded to progress_cb.
     * @return 0 on success, negative on error.
     */
    int analyze(const char* path, Result& out,
                void (*progress_cb)(float, void*) = nullptr,
                void* userdata = nullptr);

private:
    /// 4× sinc interpolation for true peak detection (ITU-R BS.1770-4 Annex 2)
    static float compute_true_peak_4x(const float* samples, int count, int channels);
};
