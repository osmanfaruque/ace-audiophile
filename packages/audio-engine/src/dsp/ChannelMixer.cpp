#include "ChannelMixer.h"
#include <cmath>
#include <algorithm>
#include <numbers>

void ChannelMixer::configure(bool swap_lr, bool mono, float balance,
                              bool invert_l, bool invert_r)
{
    m_swap = swap_lr;
    m_mono = mono;

    // Balance: -1.0 = full left, 0 = center, +1.0 = full right
    // Using constant-power panning law:
    //   L_gain = cos(θ),  R_gain = sin(θ),  θ = (balance+1)/2 * π/2
    balance = std::clamp(balance, -1.0f, 1.0f);
    float theta = (balance + 1.0f) * 0.5f * std::numbers::pi_v<float> * 0.5f;
    m_gain_l = std::cos(theta);
    m_gain_r = std::sin(theta);

    // Polarity invert
    if (invert_l) m_gain_l = -m_gain_l;
    if (invert_r) m_gain_r = -m_gain_r;

    // Determine if any processing is needed
    m_active = m_swap || m_mono || invert_l || invert_r
            || std::abs(balance) > 0.001f;
}

void ChannelMixer::process(float* buf, int frames, int channels)
{
    if (!m_active || channels < 2)
        return;

    for (int i = 0; i < frames; ++i) {
        float L = buf[i * channels];
        float R = buf[i * channels + 1];

        // 1. L/R swap
        if (m_swap) std::swap(L, R);

        // 2. Mono sum
        if (m_mono) {
            float mid = (L + R) * 0.5f;
            L = mid;
            R = mid;
        }

        // 3. Balance + polarity
        L *= m_gain_l;
        R *= m_gain_r;

        buf[i * channels]     = L;
        buf[i * channels + 1] = R;
    }
}
