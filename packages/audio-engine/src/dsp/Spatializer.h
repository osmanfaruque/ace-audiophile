#pragma once

/**
 * Virtual surround / spatializer for headphone listening (A1.3.6).
 *
 * Three complementary techniques combined:
 *
 *  1. **Mid/Side widening** — scale the Side (L−R) channel relative to Mid
 *     so the stereo image extends beyond the head.
 *
 *  2. **High-shelf on Side** — boost HF content (>2 kHz) of the Side channel
 *     to enhance HRTF-relevant spatial cues (2–8 kHz).
 *
 *  3. **Haas-effect delay** — a tiny cross-feed delay (0.1–0.4 ms) produces
 *     an externalization cue that moves the perceived sound source outside
 *     the head.
 *
 * Strength 0.0 → bypass, 1.0 → full effect.  Stereo only.
 */
class Spatializer {
public:
    /** Reconfigure parameters.
     *  @param strength    0.0 (off) – 1.0 (full virtual surround)
     *  @param sample_rate current sample rate in Hz */
    void configure(float strength, float sample_rate);

    /** Process interleaved stereo float32 audio in-place. */
    void process(float* buf, int frames, int channels);

    /** Reset internal state (call on seek / track change). */
    void reset();

private:
    void design_high_shelf();

    float m_strength{0.0f};
    float m_sample_rate{44100.0f};

    // Mid/Side width multiplier for the Side channel (1.0 = normal stereo)
    float m_width{1.0f};

    // Haas-effect cross-feed delay
    static constexpr int kMaxDelay = 128;   // enough for 0.6 ms @ 192 kHz
    int   m_delay_samples{0};
    float m_delay_mix{0.0f};                // level of delayed opposite-channel
    float m_delay_buf_l[kMaxDelay]{};
    float m_delay_buf_r[kMaxDelay]{};
    int   m_delay_pos{0};

    // First-order high-shelf filter applied to the Side signal
    //   y[n] = b0·x[n] + b1·x[n-1] − a1·y[n-1]
    float m_hs_b0{1.0f}, m_hs_b1{0.0f}, m_hs_a1{0.0f};
    float m_hs_x1{0.0f}, m_hs_y1{0.0f};
};
