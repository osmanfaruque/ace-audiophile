#include "Spatializer.h"
#include <cmath>
#include <cstring>
#include <algorithm>
#include <numbers>

// ── Strength-to-parameter mapping ────────────────────────────────────────────
//   strength 0.0 → bypass  |  0.5 → moderate  |  1.0 → full
//
//   width          1.0 … 1.8     (Side-channel gain multiplier)
//   delay_ms       0.0 … 0.4 ms  (Haas-effect inter-aural delay)
//   delay_mix      0.0 … 0.15    (cross-feed level of delayed signal)
//   shelf_gain_db  0.0 … 6.0 dB  (HF boost on Side above 2 kHz)

static constexpr float kShelfFreq = 2000.0f;  // high-shelf corner frequency

void Spatializer::configure(float strength, float sample_rate)
{
    m_strength    = std::clamp(strength, 0.0f, 1.0f);
    m_sample_rate = sample_rate;

    // Width: 1.0 (mono-ish) → 1.8 (extra-wide)
    m_width = 1.0f + m_strength * 0.8f;

    // Haas delay: up to 0.4 ms
    float delay_ms = m_strength * 0.4f;
    m_delay_samples = std::clamp(
        static_cast<int>(delay_ms * 0.001f * m_sample_rate + 0.5f),
        0, kMaxDelay - 1);
    m_delay_mix = m_strength * 0.15f;

    design_high_shelf();
}

void Spatializer::design_high_shelf()
{
    // First-order high shelf via bilinear transform.
    //   Analog prototype:  H(s) = (s + ω_0·√A) / (s + ω_0/√A)
    //   where A = 10^(gain_dB/20).

    float gain_db = m_strength * 6.0f;   // 0 … 6 dB
    if (gain_db < 0.01f) {               // effectively 0 → unity filter
        m_hs_b0 = 1.0f;
        m_hs_b1 = 0.0f;
        m_hs_a1 = 0.0f;
        return;
    }

    float A    = std::pow(10.0f, gain_db / 20.0f);
    float sqA  = std::sqrt(A);
    float w0   = 2.0f * std::numbers::pi_v<float> * kShelfFreq / m_sample_rate;
    float tan2 = std::tan(w0 * 0.5f);

    // Pre-warped analog coefficients →  bilinear
    // Numerator:   s + w0·sqA    →  (1 + tan2·sqA) + (tan2·sqA − 1) z^-1
    // Denominator: s + w0/sqA    →  (1 + tan2/sqA) + (tan2/sqA − 1) z^-1
    float num0 = 1.0f + tan2 * sqA;
    float num1 = tan2 * sqA - 1.0f;
    float den0 = 1.0f + tan2 / sqA;
    float den1 = tan2 / sqA - 1.0f;

    m_hs_b0 = num0 / den0;
    m_hs_b1 = num1 / den0;
    m_hs_a1 = den1 / den0;     // stored with negated convention: y = b0·x + b1·x1 − a1·y1
}

void Spatializer::process(float* buf, int frames, int channels)
{
    if (channels != 2 || m_strength < 1e-6f)
        return;

    for (int i = 0; i < frames; ++i) {
        float L = buf[i * 2];
        float R = buf[i * 2 + 1];

        // ── 1. Mid/Side decompose ──
        float M = (L + R) * 0.5f;
        float S = (L - R) * 0.5f;

        // ── 2. High-shelf on Side ──
        float S_filt = m_hs_b0 * S + m_hs_b1 * m_hs_x1 - m_hs_a1 * m_hs_y1;
        m_hs_x1 = S;
        m_hs_y1 = S_filt;

        // ── 3. Width scaling ──
        S_filt *= m_width;

        // ── 4. Reconstruct L/R ──
        float Lw = M + S_filt;
        float Rw = M - S_filt;

        // ── 5. Haas-effect delay cross-feed ──
        if (m_delay_samples > 0) {
            int read_pos = (m_delay_pos - m_delay_samples + kMaxDelay) % kMaxDelay;
            float del_L = m_delay_buf_l[read_pos];
            float del_R = m_delay_buf_r[read_pos];

            // Mix delayed opposite channel
            Lw += m_delay_mix * del_R;
            Rw += m_delay_mix * del_L;

            // Write current samples to delay line
            m_delay_buf_l[m_delay_pos] = Lw;
            m_delay_buf_r[m_delay_pos] = Rw;
            m_delay_pos = (m_delay_pos + 1) % kMaxDelay;
        }

        buf[i * 2]     = Lw;
        buf[i * 2 + 1] = Rw;
    }
}

void Spatializer::reset()
{
    std::memset(m_delay_buf_l, 0, sizeof(m_delay_buf_l));
    std::memset(m_delay_buf_r, 0, sizeof(m_delay_buf_r));
    m_delay_pos = 0;
    m_hs_x1 = 0.0f;
    m_hs_y1 = 0.0f;
}
