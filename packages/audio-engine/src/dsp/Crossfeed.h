#pragma once

/**
 * Bauer stereophonic-to-binaural (BS2B) cross-feed for headphone listening.
 *
 * Mixes a low-pass-filtered version of each channel into the opposite channel,
 * simulating the natural acoustic cross-feed heard with loudspeakers.
 *
 * Algorithm per sample pair:
 *   L_out = L − g·(LPF(L) − LPF(R))
 *   R_out = R − g·(LPF(R) − LPF(L))
 *
 * At DC  (LPF gain = 1): cross-mix ratio = g  → speaker-like imaging
 * At HF  (LPF gain → 0): no cross-feed       → full stereo separation
 * Unity gain at every frequency.
 */
class Crossfeed {
public:
    /** Reconfigure and recompute filter coefficients.
     *  @param strength    0.0 (bypass) – 1.0 (heavy, ~9.5 dB equivalent)
     *  @param sample_rate current sample rate in Hz */
    void configure(float strength, float sample_rate);

    /** Process interleaved stereo float32 audio in-place. */
    void process(float* buf, int frames, int channels);

    /** Reset filter state (call on seek / track change). */
    void reset();

private:
    void design_lpf();

    float m_strength{0.0f};
    float m_sample_rate{44100.0f};

    // Cross-feed coefficient (linear, derived from strength)
    float m_g{0.0f};

    // Standard BS2B crossover frequency
    static constexpr float kCutFreq = 700.0f;

    // First-order IIR low-pass:  y[n] = b0·x[n] + b1·x[n-1] − a1·y[n-1]
    float m_b0{0.0f}, m_b1{0.0f}, m_a1{0.0f};

    struct LpfState { float x1{0.0f}, y1{0.0f}; };
    LpfState m_lpf_l{};   // LPF for left channel
    LpfState m_lpf_r{};   // LPF for right channel
};
