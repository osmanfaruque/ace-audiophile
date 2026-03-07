#include "Crossfeed.h"

void Crossfeed::set_strength(float s) { m_strength = s; }

void Crossfeed::process(float* buf, int frames, int channels)
{
    if (channels < 2 || m_strength <= 0.0f) return;
    // Simple Bauer stereophonic-to-binaural (abbreviated stub)
    // TODO: implement full BS2B algorithm with low-pass cross-feed path
    float w = m_strength * 0.3f;
    for (int f = 0; f < frames; ++f) {
        float l = buf[f * 2];
        float r = buf[f * 2 + 1];
        buf[f * 2]     = l * (1.0f - w) + r * w;
        buf[f * 2 + 1] = r * (1.0f - w) + l * w;
    }
}
