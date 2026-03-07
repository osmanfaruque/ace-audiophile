#include "Resampler.h"

void Resampler::configure(uint32_t in_hz, uint32_t out_hz)
{
    m_in_hz  = in_hz;
    m_out_hz = out_hz;
    m_phase  = 0.0;
}

int Resampler::process(const float* in, int in_frames, float* out, int out_cap, int channels)
{
    if (m_in_hz == m_out_hz) {
        int n = in_frames < out_cap ? in_frames : out_cap;
        for (int i = 0; i < n * channels; ++i) out[i] = in[i];
        return n;
    }
    // TODO: implement polyphase / SRC-quality resampler
    // Stub: nearest-neighbour upsampling / downsampling
    double ratio = (double)m_in_hz / m_out_hz;
    int written = 0;
    while (written < out_cap) {
        int src = (int)(m_phase);
        if (src >= in_frames) break;
        for (int c = 0; c < channels; ++c)
            out[written * channels + c] = in[src * channels + c];
        ++written;
        m_phase += ratio;
    }
    m_phase -= (int)m_phase;  // keep fractional only
    return written;
}
