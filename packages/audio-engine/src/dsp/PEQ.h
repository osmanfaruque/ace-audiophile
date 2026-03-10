#pragma once
#include "ace_engine.h"
#include <array>
#include <cstdint>

/**
 * 60-band parametric EQ using biquad IIR filters (Transposed Direct Form II).
 * Supports all standard Audio EQ Cookbook filter types:
 *   peaking, low shelf, high shelf, LPF, HPF, BPF, notch, all-pass.
 * One filter instance per band per channel (stereo max).
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

    static void design(uint8_t filter_type, double freq, double gain_db, double Q,
                       double fs, double& b0, double& b1, double& b2,
                       double& a0, double& a1, double& a2);

    std::array<std::array<Biquad, ACE_EQ_BANDS>, 2> m_filters{};
    uint64_t m_active{0};   // bitmask — bit i set if band i is active (max 60 < 64)
    float m_sample_rate{44100.0f};
};
