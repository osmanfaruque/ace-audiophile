#pragma once
#include "ace_engine.h"

class DspChain {
public:
    void apply(const AceDspState& state);
    // process() is called on the audio thread with interleaved PCM float32 samples
    void process(float* buf, int frames, int channels);
};
