#pragma once

class Dither {
public:
    void configure(int target_bits);
    void process(float* buf, int frames, int channels);
private:
    int   m_bits{16};
    float m_scale{1.0f};
};
