#pragma once
#include "ace_engine.h"

class Spectrogram {
public:
    /** Run Short-Time Fourier Transform on interleaved stereo PCM.
     *  Returns an AceFftFrame populated with per-channel magnitude bins. */
    void compute(const float* pcm, int frames, int sample_rate, AceFftFrame& out);
private:
    // TODO: use KissFFT or FFTW3 with a Hann window
};
