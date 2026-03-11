#pragma once
#include <cstdint>
#include <vector>

/**
 * Brickwall look-ahead limiter + anti-clip guard (A1.3.8).
 *
 * Placed at the very end of the DSP chain (after dither) to guarantee
 * the output never exceeds a configurable ceiling (default −0.1 dBFS).
 *
 * Features:
 *   - **Look-ahead**: delays audio by a short window (default 5 ms) so the
 *     limiter can anticipate peaks and apply smooth gain reduction.
 *   - **Program-dependent release**: fast release for transients, slow for
 *     sustained over-threshold passages to avoid pumping.
 *   - **True-peak awareness**: 4× oversampled peak detection for inter-sample
 *     peak limiting.
 *   - **Hard ceiling**: after the limiter, a final clamp ensures absolute
 *     safety even in edge cases.
 *
 * Stereo-linked: gain reduction is identical on both channels to preserve
 * the stereo image.
 */
class Limiter {
public:
    /** Configure limiter parameters.
     *  @param enabled      Non-zero to enable limiting (0 = bypass with hard clamp only).
     *  @param ceiling_db   Output ceiling in dBFS (e.g. −0.1).
     *  @param release_ms   Release time in ms (50–500, default 200).
     *  @param sample_rate  Current sample rate in Hz. */
    void configure(bool enabled, float ceiling_db, float release_ms, float sample_rate);

    /** Process interleaved float32 audio in-place.
     *  Note: the limiter introduces a look-ahead delay of ~5 ms. */
    void process(float* buf, int frames, int channels);

    /** Reset internal state (call on seek / track change). */
    void reset();

    /** Current gain reduction in dB (for metering, always ≤ 0). */
    float gain_reduction_db() const;

private:
    /** Compute the maximum inter-sample true peak for a stereo frame. */
    float true_peak(float L, float R);

    bool  m_enabled{false};
    float m_ceiling{0.989f};       // −0.1 dBFS default (linear)
    float m_sample_rate{44100.0f};

    // Look-ahead delay line (interleaved stereo)
    static constexpr float kLookaheadMs = 5.0f;
    int m_lookahead_samples{0};
    std::vector<float> m_delay_buf;     // ring buffer, interleaved
    int m_delay_write{0};

    // Gain envelope (linear)
    float m_envelope{1.0f};             // current gain (≤ 1.0)
    float m_attack_coeff{0.0f};         // per-sample attack smoothing
    float m_release_coeff{0.0f};        // per-sample release smoothing

    // 4× oversampling history for true-peak detection
    float m_hist_l[3]{};
    float m_hist_r[3]{};
};
