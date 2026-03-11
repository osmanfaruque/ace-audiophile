#pragma once
#include <cstdint>

/**
 * TPDF dither with optional noise shaping for bit-depth reduction.
 *
 * Supported target bit depths: 16, 20, 24, 32 (32-bit = float passthrough dither).
 *
 * Noise shaping uses a second-order error-feedback filter (F-weighted)
 * that pushes dither noise energy above ~14 kHz where human hearing is
 * least sensitive, improving perceived SNR by ~7–11 dB over flat TPDF.
 *
 * PRNG: xorshift64* — fast, deterministic, no stdlib dependency.
 */
class Dither {
public:
    /** Configure target bit depth and noise-shaping mode.
     *  @param bits           Target bit depth (16, 20, 24, or 32).
     *  @param noise_shaping  Enable second-order noise shaping. */
    void configure(int bits, bool noise_shaping = true);

    /** Process interleaved float32 audio in-place. */
    void process(float* buf, int frames, int channels);

    /** Reset noise-shaping filter state (call on seek / track change). */
    void reset();

private:
    float next_tpdf();  // returns TPDF noise in range [-1, +1]

    int   m_bits{16};
    float m_quant_step{0.0f};    // 1 LSB in float (= 2 / 2^bits)
    bool  m_noise_shaping{true};

    // xorshift64* PRNG state
    uint64_t m_rng_state{0x123456789ABCDEF0ULL};

    // Second-order error feedback state (per channel, max 2 channels)
    static constexpr int kMaxChannels = 2;
    float m_err[kMaxChannels][2]{};  // err[ch][0] = e[n-1], err[ch][1] = e[n-2]
};
