#include "Crossfeed.h"
#include <cmath>
#include <algorithm>
#include <numbers>

void Crossfeed::configure(float strength, float sample_rate)
{
    m_strength    = std::clamp(strength, 0.0f, 1.0f);
    m_sample_rate = sample_rate > 0.0f ? sample_rate : 44100.0f;

    // Map strength → cross-feed coefficient g.
    // 0.0 → 0.0  (no cross-feed)
    // 0.5 → 0.225 (moderate, ~4.5 dB equivalent)
    // 1.0 → 0.45  (heavy,   ~9.5 dB equivalent)
    m_g = m_strength * 0.45f;

    design_lpf();
}

void Crossfeed::design_lpf()
{
    // First-order low-pass via bilinear transform.
    //   H(s) = 1 / (s/ω₀ + 1)
    //   K  = tan(π · fc / fs)
    //   b0 = K / (K + 1)
    //   b1 = b0
    //   a1 = (K − 1) / (K + 1)
    float fc   = std::min(kCutFreq, m_sample_rate * 0.45f);
    float K    = std::tan(std::numbers::pi_v<float> * fc / m_sample_rate);
    float norm = 1.0f / (K + 1.0f);

    m_b0 = K * norm;
    m_b1 = m_b0;
    m_a1 = (K - 1.0f) * norm;
}

void Crossfeed::reset()
{
    m_lpf_l = {};
    m_lpf_r = {};
}

void Crossfeed::process(float* buf, int frames, int channels)
{
    if (channels < 2 || m_g <= 0.0f) return;

    for (int f = 0; f < frames; ++f) {
        float L = buf[f * 2];
        float R = buf[f * 2 + 1];

        // Low-pass filter each channel independently
        float lp_l = m_b0 * L + m_b1 * m_lpf_l.x1 - m_a1 * m_lpf_l.y1;
        m_lpf_l.x1 = L;
        m_lpf_l.y1 = lp_l;

        float lp_r = m_b0 * R + m_b1 * m_lpf_r.x1 - m_a1 * m_lpf_r.y1;
        m_lpf_r.x1 = R;
        m_lpf_r.y1 = lp_r;

        // Bauer cross-feed:
        //   L_out = L − g·(LPF(L) − LPF(R))
        //   R_out = R − g·(LPF(R) − LPF(L))
        // At DC:  output = L·(1−g) + R·g  (cross-mix)
        // At HF:  output = L                (no cross-feed)
        float diff = lp_l - lp_r;
        buf[f * 2]     = L - m_g * diff;
        buf[f * 2 + 1] = R + m_g * diff;
    }
}
