#include "Limiter.h"
#include <cmath>
#include <cstring>
#include <algorithm>

// ── Cubic Lagrange interpolation (same as ReplayGain) ────────────────────────
static float interp4(float s0, float s1, float s2, float s3, float t)
{
    float c0 = s1;
    float c1 = 0.5f * (s2 - s0);
    float c2 = s0 - 2.5f * s1 + 2.0f * s2 - 0.5f * s3;
    float c3 = 0.5f * (s3 - s0) + 1.5f * (s1 - s2);
    return ((c3 * t + c2) * t + c1) * t + c0;
}

static float peak_4x(float s0, float s1, float s2, float s3)
{
    float peak = std::max(std::abs(s1), std::abs(s2));
    for (float t : {0.25f, 0.50f, 0.75f}) {
        float v = std::abs(interp4(s0, s1, s2, s3, t));
        if (v > peak) peak = v;
    }
    return peak;
}

void Limiter::configure(bool enabled, float ceiling_db, float release_ms, float sample_rate)
{
    m_enabled     = enabled;
    m_sample_rate = sample_rate;
    m_ceiling     = std::pow(10.0f, std::min(ceiling_db, 0.0f) / 20.0f);

    // Look-ahead delay
    m_lookahead_samples = static_cast<int>(kLookaheadMs * 0.001f * sample_rate + 0.5f);
    if (m_lookahead_samples < 1) m_lookahead_samples = 1;

    // Resize delay buffer (interleaved stereo)
    m_delay_buf.resize(static_cast<size_t>(m_lookahead_samples * 2), 0.0f);
    m_delay_write = 0;

    // Attack time = look-ahead window (so gain ramps down over the full look-ahead)
    float attack_ms = kLookaheadMs;
    m_attack_coeff  = 1.0f - std::exp(-2.2f / (attack_ms  * 0.001f * sample_rate));
    m_release_coeff = 1.0f - std::exp(-2.2f / (std::clamp(release_ms, 50.0f, 500.0f) * 0.001f * sample_rate));
}

float Limiter::true_peak(float L, float R)
{
    // Update history and compute 4× oversampled peak per channel
    float tp_l = peak_4x(m_hist_l[0], m_hist_l[1], m_hist_l[2], L);
    float tp_r = peak_4x(m_hist_r[0], m_hist_r[1], m_hist_r[2], R);

    m_hist_l[0] = m_hist_l[1]; m_hist_l[1] = m_hist_l[2]; m_hist_l[2] = L;
    m_hist_r[0] = m_hist_r[1]; m_hist_r[1] = m_hist_r[2]; m_hist_r[2] = R;

    return std::max(tp_l, tp_r);
}

void Limiter::process(float* buf, int frames, int channels)
{
    if (!m_enabled) {
        // Bypass: just hard-clamp (anti-clip safety net)
        int total = frames * channels;
        for (int i = 0; i < total; ++i)
            buf[i] = std::clamp(buf[i], -1.0f, 1.0f);
        return;
    }

    int ch = std::min(channels, 2);
    int delay_size = m_lookahead_samples;

    for (int i = 0; i < frames; ++i) {
        float in_L = buf[i * channels];
        float in_R = (ch > 1) ? buf[i * channels + 1] : in_L;

        // ── True-peak detection on incoming audio ──
        float tp = true_peak(in_L, in_R);

        // ── Compute target gain for this sample ──
        float target_gain = 1.0f;
        if (tp > m_ceiling)
            target_gain = m_ceiling / tp;

        // ── Smooth envelope (attack/release) ──
        if (target_gain < m_envelope) {
            // Attack: gain going down (fast, keyed to look-ahead)
            m_envelope += m_attack_coeff * (target_gain - m_envelope);
        } else {
            // Release: gain recovering (slow)
            m_envelope += m_release_coeff * (target_gain - m_envelope);
        }
        // Ensure envelope never exceeds unity
        if (m_envelope > 1.0f) m_envelope = 1.0f;

        // ── Read delayed audio from ring buffer ──
        int read_pos = m_delay_write;  // oldest sample in ring = current write pos
        float del_L = m_delay_buf[read_pos * 2];
        float del_R = m_delay_buf[read_pos * 2 + 1];

        // ── Write current input to ring buffer ──
        m_delay_buf[m_delay_write * 2]     = in_L;
        m_delay_buf[m_delay_write * 2 + 1] = in_R;
        m_delay_write = (m_delay_write + 1) % delay_size;

        // ── Apply gain reduction to delayed audio ──
        float out_L = del_L * m_envelope;
        float out_R = del_R * m_envelope;

        // ── Final hard clamp (absolute safety) ──
        buf[i * channels]     = std::clamp(out_L, -1.0f, 1.0f);
        if (ch > 1)
            buf[i * channels + 1] = std::clamp(out_R, -1.0f, 1.0f);
    }
}

void Limiter::reset()
{
    m_envelope = 1.0f;
    m_delay_write = 0;
    std::fill(m_delay_buf.begin(), m_delay_buf.end(), 0.0f);
    std::memset(m_hist_l, 0, sizeof(m_hist_l));
    std::memset(m_hist_r, 0, sizeof(m_hist_r));
}

float Limiter::gain_reduction_db() const
{
    if (m_envelope >= 1.0f) return 0.0f;
    return 20.0f * std::log10(m_envelope);
}
