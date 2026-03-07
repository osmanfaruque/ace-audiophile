#include "Spectrogram.h"
#include <cstring>

void Spectrogram::compute(const float* /*pcm*/, int /*frames*/, int /*sample_rate*/, AceFftFrame& out)
{
    // TODO: Hann-windowed FFT, overlap-add, log-scale magnitude
    memset(&out, 0, sizeof(out));
}
