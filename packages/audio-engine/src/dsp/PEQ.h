#pragma once
#include "ace_engine.h"
#include <array>

/**
 * 60-band parametric EQ using biquad IIR filters (transposed Direct Form II).
 * One filter instance per band per channel.
 */
class PEQ {
public:
    void configure(const AceEqBand bands[ACE_EQ_BANDS], float sample_rate);
    void process(float* buf, int frames, int channels);
    void reset();
private:
    struct Biquad {
        double b0{1}, b1{0}, b2{0}, a1{0}, a2{0};
        double z1{0}, z2{0};
        inline float tick(float x) {
            double y = b0*x + z1;
            z1 = b1*x - a1*y + z2;
            z2 = b2*x - a2*y;
            return static_cast<float>(y);
        }
    };
    std::array<std::array<Biquad, ACE_EQ_BANDS>, 2> m_filters{};
    float m_sample_rate{44100.0f};
};
