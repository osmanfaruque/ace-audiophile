#include "Dither.h"
#include <cmath>
#include <algorithm>

void Dither::configure(int bits, bool noise_shaping)
{
    m_bits = std::clamp(bits, 16, 32);
    m_noise_shaping = noise_shaping;

    // 1 LSB in normalized float [-1, +1] for target bit depth
    // For N-bit signed integer: full range = 2^N values, step = 2.0 / 2^N
    m_quant_step = 2.0f / static_cast<float>(1 << m_bits);

    reset();
}

void Dither::reset()
{
    for (int ch = 0; ch < kMaxChannels; ++ch) {
        m_err[ch][0] = 0.0f;
        m_err[ch][1] = 0.0f;
    }
}

float Dither::next_tpdf()
{
    // xorshift64* — Marsaglia
    uint64_t x = m_rng_state;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    m_rng_state = x;
    uint64_t r1 = x * 0x2545F4914F6CDD1DULL;

    x = m_rng_state;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    m_rng_state = x;
    uint64_t r2 = x * 0x2545F4914F6CDD1DULL;

    // Convert to [-0.5, +0.5] each, sum → TPDF in [-1, +1]
    float u1 = static_cast<float>(static_cast<int64_t>(r1)) / static_cast<float>(INT64_MAX);
    float u2 = static_cast<float>(static_cast<int64_t>(r2)) / static_cast<float>(INT64_MAX);
    return (u1 + u2) * 0.5f;  // TPDF, triangular distribution, range [-1, +1]
}

void Dither::process(float* buf, int frames, int channels)
{
    if (m_bits >= 32 && !m_noise_shaping) return;  // float output, nothing to do

    float lsb = m_quant_step;
    int ch_count = std::min(channels, kMaxChannels);

    for (int f = 0; f < frames; ++f) {
        for (int ch = 0; ch < ch_count; ++ch) {
            int idx = f * channels + ch;
            float x = buf[idx];

            if (m_noise_shaping) {
                // Second-order error-feedback noise shaping (F-weighted).
                // Coefficients push noise energy toward high frequencies.
                //   shaped = x - (1.5·e[n-1] - 0.5·e[n-2])
                // This is a simple but effective 2nd-order high-pass feedback
                // that provides ~7-11 dB perceptual improvement over flat TPDF.
                float shaped = x - (1.5f * m_err[ch][0] - 0.5f * m_err[ch][1]);

                // Add TPDF dither (amplitude = 1 LSB peak)
                float dithered = shaped + lsb * next_tpdf();

                // Quantize to target bit depth
                float scale = 1.0f / lsb;
                float quantized = std::round(dithered * scale) * lsb;

                // Compute quantization error for feedback
                float error = quantized - shaped;
                m_err[ch][1] = m_err[ch][0];
                m_err[ch][0] = error;

                buf[idx] = quantized;
            } else {
                // Flat TPDF dither without noise shaping
                float dithered = x + lsb * next_tpdf();
                float scale = 1.0f / lsb;
                buf[idx] = std::round(dithered * scale) * lsb;
            }
        }
    }
}
