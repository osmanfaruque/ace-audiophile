#pragma once
#include <cstdint>

/**
 * ChannelMixer — stereo channel manipulation matrix (A1.3.10).
 *
 * Supports:
 *   - L/R swap
 *   - Mono sum (L+R)/2 to both channels
 *   - Balance (pan L/R)
 *   - Polarity (phase) invert per channel
 *
 * Applied in-place on interleaved stereo float32 PCM.
 * Chain position: after spatializer, before resampler.
 */
class ChannelMixer {
public:
    /** Configure the mixer. */
    void configure(bool swap_lr, bool mono, float balance,
                   bool invert_l, bool invert_r);

    /** Process interleaved stereo float32 audio in-place. */
    void process(float* buf, int frames, int channels);

    /** Whether any processing is active. */
    bool active() const { return m_active; }

private:
    bool  m_active{false};
    bool  m_swap{false};
    bool  m_mono{false};
    float m_gain_l{1.0f};   // combined balance + invert for L
    float m_gain_r{1.0f};   // combined balance + invert for R
};
