#pragma once
#include <cstdint>

class Resampler {
public:
    void configure(uint32_t input_hz, uint32_t output_hz);
    // Returns number of output frames written
    int process(const float* in, int in_frames, float* out, int out_cap, int channels);
private:
    uint32_t m_in_hz{44100};
    uint32_t m_out_hz{44100};
    double   m_phase{0.0};
};
