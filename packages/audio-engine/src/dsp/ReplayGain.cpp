#include "ReplayGain.h"
#include <cmath>
#include <cstring>
#include <algorithm>

// ── 4-point Lagrange interpolation coefficients for 4× oversampling ─────────
// Given samples s0..s3 at integer positions, evaluate at fractional offsets
// 0.25, 0.50, 0.75 to find inter-sample peaks.

static float interp4(float s0, float s1, float s2, float s3, float t)
{
    // Cubic Lagrange interpolation at offset t (0..1) among s0,s1,s2,s3
    // centered so t=0 → s1, t=1 → s2
    float c0 = s1;
    float c1 = 0.5f * (s2 - s0);
    float c2 = s0 - 2.5f * s1 + 2.0f * s2 - 0.5f * s3;
    float c3 = 0.5f * (s3 - s0) + 1.5f * (s1 - s2);
    return ((c3 * t + c2) * t + c1) * t + c0;
}

float ReplayGain::true_peak_4x(float s0, float s1, float s2, float s3) const
{
    float peak = std::max(std::abs(s1), std::abs(s2));
    // Check 3 inter-sample positions between s1 and s2
    for (float t : {0.25f, 0.50f, 0.75f}) {
        float v = std::abs(interp4(s0, s1, s2, s3, t));
        if (v > peak) peak = v;
    }
    return peak;
}

void ReplayGain::configure(Mode mode, float track_gain, float album_gain,
                           float track_peak, float album_peak,
                           float pre_amp, float ceiling_db, float sample_rate)
{
    m_mode = mode;

    if (mode == Mode::Off) {
        m_gain_linear      = 1.0f;
        m_effective_gain_db = 0.0f;
        return;
    }

    // Select gain/peak based on mode
    float gain_db = (mode == Mode::Track) ? track_gain : album_gain;
    float peak    = (mode == Mode::Track) ? track_peak : album_peak;

    // Add user pre-amp offset
    gain_db += pre_amp;

    // Prevent clipping: if applying gain would exceed ceiling, reduce gain
    // peak * 10^(gain_db/20) <= ceiling_linear  →  gain_db <= 20*log10(ceiling/peak)
    m_ceiling = std::pow(10.0f, ceiling_db / 20.0f);

    if (peak > 0.0f) {
        float max_gain_db = 20.0f * std::log10(m_ceiling / peak);
        gain_db = std::min(gain_db, max_gain_db);
    }

    m_effective_gain_db = gain_db;
    m_gain_linear       = std::pow(10.0f, gain_db / 20.0f);

    // Limiter time constants
    // Attack: ~0.5 ms (fast, to catch transients)
    // Release: ~100 ms (smooth, to avoid pumping)
    float attack_ms  = 0.5f;
    float release_ms = 100.0f;
    m_attack_coeff  = 1.0f - std::exp(-1.0f / (attack_ms  * 0.001f * sample_rate));
    m_release_coeff = 1.0f - std::exp(-1.0f / (release_ms * 0.001f * sample_rate));
}

void ReplayGain::process(float* buf, int frames, int channels)
{
    if (m_mode == Mode::Off)
        return;

    int ch = std::min(channels, kMaxChannels);

    for (int i = 0; i < frames; ++i) {
        // Apply gain
        for (int c = 0; c < ch; ++c)
            buf[i * channels + c] *= m_gain_linear;

        // True-peak detection via 4× oversampling per channel
        float frame_peak = 0.0f;
        for (int c = 0; c < ch; ++c) {
            float s = buf[i * channels + c];
            // m_hist[c] = {n-3, n-2, n-1}, current = s (n)
            float tp = true_peak_4x(m_hist[c][0], m_hist[c][1], m_hist[c][2], s);
            if (tp > frame_peak) frame_peak = tp;

            // Shift history
            m_hist[c][0] = m_hist[c][1];
            m_hist[c][1] = m_hist[c][2];
            m_hist[c][2] = s;
        }

        // Limiter: reduce gain if true peak exceeds ceiling
        if (frame_peak > m_ceiling) {
            float target_env = frame_peak / m_ceiling;
            // Fast attack
            m_limiter_env += m_attack_coeff * (target_env - m_limiter_env);
        } else {
            // Slow release
            m_limiter_env += m_release_coeff * (1.0f - m_limiter_env);
        }

        // Ensure envelope never goes below 1.0
        if (m_limiter_env < 1.0f) m_limiter_env = 1.0f;

        // Apply limiting
        if (m_limiter_env > 1.0f) {
            float reduction = 1.0f / m_limiter_env;
            for (int c = 0; c < ch; ++c)
                buf[i * channels + c] *= reduction;
        }
    }
}

void ReplayGain::reset()
{
    m_limiter_env = 0.0f;
    std::memset(m_hist, 0, sizeof(m_hist));
}
