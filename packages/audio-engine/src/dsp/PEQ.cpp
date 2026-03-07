#include "PEQ.h"
#include <cmath>

static constexpr double kPi = 3.14159265358979323846;

static void design_peaking(
    double freq, double gain_db, double Q, double fs,
    double& b0, double& b1, double& b2, double& a0, double& a1, double& a2)
{
    double A  = std::pow(10.0, gain_db / 40.0);
    double w0 = 2.0 * kPi * freq / fs;
    double alpha = std::sin(w0) / (2.0 * Q);

    b0 =  1.0 + alpha * A;
    b1 = -2.0 * std::cos(w0);
    b2 =  1.0 - alpha * A;
    a0 =  1.0 + alpha / A;
    a1 = -2.0 * std::cos(w0);
    a2 =  1.0 - alpha / A;
}

void PEQ::configure(const AceEqBand bands[ACE_EQ_BANDS], float sample_rate)
{
    m_sample_rate = sample_rate;
    for (int b = 0; b < ACE_EQ_BANDS; ++b) {
        if (!bands[b].enabled || bands[b].gain_db == 0.0f) {
            // Identity biquad
            for (auto& ch : m_filters) {
                ch[b] = Biquad{};
            }
            continue;
        }
        double b0, b1, b2, a0, a1, a2;
        design_peaking(bands[b].freq_hz, bands[b].gain_db, bands[b].q, sample_rate,
                       b0, b1, b2, a0, a1, a2);
        for (auto& ch : m_filters) {
            ch[b].b0 = b0 / a0;
            ch[b].b1 = b1 / a0;
            ch[b].b2 = b2 / a0;
            ch[b].a1 = a1 / a0;
            ch[b].a2 = a2 / a0;
        }
    }
}

void PEQ::process(float* buf, int frames, int channels)
{
    for (int f = 0; f < frames; ++f) {
        for (int c = 0; c < channels && c < 2; ++c) {
            float s = buf[f * channels + c];
            for (int b = 0; b < ACE_EQ_BANDS; ++b) {
                s = m_filters[c][b].tick(s);
            }
            buf[f * channels + c] = s;
        }
    }
}

void PEQ::reset()
{
    for (auto& ch : m_filters)
        for (auto& bq : ch)
            bq = Biquad{};
}
