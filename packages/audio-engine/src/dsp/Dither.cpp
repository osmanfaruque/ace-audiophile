#include "Dither.h"
#include <cmath>
#include <cstdlib>

void Dither::configure(int bits)
{
    m_bits  = bits;
    m_scale = 1.0f / (1 << (bits - 1));
}

void Dither::process(float* buf, int frames, int channels)
{
    // TPDF dither: two uniform noise sources summed
    // TODO: add noise shaping filter for better perceived quality
    float lsb = m_scale;
    for (int i = 0; i < frames * channels; ++i) {
        float r1 = (float)rand() / RAND_MAX - 0.5f;
        float r2 = (float)rand() / RAND_MAX - 0.5f;
        buf[i] += lsb * (r1 + r2);
    }
}
