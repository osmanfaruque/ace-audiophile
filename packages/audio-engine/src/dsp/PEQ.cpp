/**
 * PEQ.cpp — 60-band Parametric EQ (A1.3.1)
 *
 * All biquad coefficient designs follow Robert Bristow-Johnson's
 * "Audio EQ Cookbook" (Transposed Direct Form II).
 *
 * Supported filter types:
 *   0  Peaking EQ        (gain-dependent, parametric)
 *   1  Low shelf          (gain-dependent)
 *   2  High shelf         (gain-dependent)
 *   3  Low-pass           (2nd order Butterworth-like)
 *   4  High-pass          (2nd order Butterworth-like)
 *   5  Band-pass          (constant skirt gain, peak = Q)
 *   6  Notch              (band reject)
 *   7  All-pass           (phase shift only)
 */
#include "PEQ.h"
#include <cmath>
#include <algorithm>

static constexpr double kPi = 3.14159265358979323846;

void PEQ::design(uint8_t filter_type, double freq, double gain_db, double Q,
                 double fs, double& b0, double& b1, double& b2,
                 double& a0, double& a1, double& a2)
{
    // Clamp frequency to Nyquist - epsilon to avoid singularity
    freq = std::clamp(freq, 10.0, fs * 0.499);
    Q    = std::max(Q, 0.01);

    double A     = std::pow(10.0, gain_db / 40.0);   // sqrt of linear gain
    double w0    = 2.0 * kPi * freq / fs;
    double cosw0 = std::cos(w0);
    double sinw0 = std::sin(w0);
    double alpha  = sinw0 / (2.0 * Q);

    switch (static_cast<AceFilterType>(filter_type)) {

    case ACE_FILTER_PEAKING:
        b0 =  1.0 + alpha * A;
        b1 = -2.0 * cosw0;
        b2 =  1.0 - alpha * A;
        a0 =  1.0 + alpha / A;
        a1 = -2.0 * cosw0;
        a2 =  1.0 - alpha / A;
        break;

    case ACE_FILTER_LOW_SHELF: {
        double sqA   = std::sqrt(A);
        double t     = 2.0 * sqA * alpha;
        b0 =        A * ((A + 1.0) - (A - 1.0) * cosw0 + t);
        b1 =  2.0 * A * ((A - 1.0) - (A + 1.0) * cosw0);
        b2 =        A * ((A + 1.0) - (A - 1.0) * cosw0 - t);
        a0 =              (A + 1.0) + (A - 1.0) * cosw0 + t;
        a1 = -2.0 *      ((A - 1.0) + (A + 1.0) * cosw0);
        a2 =              (A + 1.0) + (A - 1.0) * cosw0 - t;
        break;
    }

    case ACE_FILTER_HIGH_SHELF: {
        double sqA   = std::sqrt(A);
        double t     = 2.0 * sqA * alpha;
        b0 =        A * ((A + 1.0) + (A - 1.0) * cosw0 + t);
        b1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cosw0);
        b2 =        A * ((A + 1.0) + (A - 1.0) * cosw0 - t);
        a0 =              (A + 1.0) - (A - 1.0) * cosw0 + t;
        a1 =  2.0 *      ((A - 1.0) - (A + 1.0) * cosw0);
        a2 =              (A + 1.0) - (A - 1.0) * cosw0 - t;
        break;
    }

    case ACE_FILTER_LOW_PASS:
        b0 = (1.0 - cosw0) / 2.0;
        b1 =  1.0 - cosw0;
        b2 = (1.0 - cosw0) / 2.0;
        a0 =  1.0 + alpha;
        a1 = -2.0 * cosw0;
        a2 =  1.0 - alpha;
        break;

    case ACE_FILTER_HIGH_PASS:
        b0 =  (1.0 + cosw0) / 2.0;
        b1 = -(1.0 + cosw0);
        b2 =  (1.0 + cosw0) / 2.0;
        a0 =   1.0 + alpha;
        a1 =  -2.0 * cosw0;
        a2 =   1.0 - alpha;
        break;

    case ACE_FILTER_BAND_PASS:
        b0 =  alpha;
        b1 =  0.0;
        b2 = -alpha;
        a0 =  1.0 + alpha;
        a1 = -2.0 * cosw0;
        a2 =  1.0 - alpha;
        break;

    case ACE_FILTER_NOTCH:
        b0 =  1.0;
        b1 = -2.0 * cosw0;
        b2 =  1.0;
        a0 =  1.0 + alpha;
        a1 = -2.0 * cosw0;
        a2 =  1.0 - alpha;
        break;

    case ACE_FILTER_ALL_PASS:
        b0 =  1.0 - alpha;
        b1 = -2.0 * cosw0;
        b2 =  1.0 + alpha;
        a0 =  1.0 + alpha;
        a1 = -2.0 * cosw0;
        a2 =  1.0 - alpha;
        break;

    default:
        // Unknown type → identity
        b0 = 1.0; b1 = 0.0; b2 = 0.0;
        a0 = 1.0; a1 = 0.0; a2 = 0.0;
        break;
    }
}

void PEQ::configure(const AceEqBand bands[ACE_EQ_BANDS], float sample_rate)
{
    m_sample_rate = sample_rate;
    m_active = 0;

    for (int b = 0; b < ACE_EQ_BANDS; ++b) {
        const auto& band = bands[b];

        // For gain-dependent types (peaking, shelves), skip if gain == 0 and disabled
        bool is_identity = !band.enabled;
        if (!is_identity && band.filter_type <= ACE_FILTER_HIGH_SHELF && band.gain_db == 0.0f)
            is_identity = true;

        if (is_identity) {
            for (auto& ch : m_filters)
                ch[b] = Biquad{};  // identity: b0=1, rest=0
            continue;
        }

        // Clamp gain to ±24 dB
        double gain = std::clamp(static_cast<double>(band.gain_db), -24.0, 24.0);

        double b0, b1, b2, a0, a1, a2;
        design(band.filter_type, band.freq_hz, gain, band.q, sample_rate,
               b0, b1, b2, a0, a1, a2);

        for (auto& ch : m_filters) {
            ch[b].b0 = b0 / a0;
            ch[b].b1 = b1 / a0;
            ch[b].b2 = b2 / a0;
            ch[b].a1 = a1 / a0;
            ch[b].a2 = a2 / a0;
            // Preserve filter state (z1, z2) to avoid clicks on parameter change
        }

        m_active |= (uint64_t{1} << b);
    }
}

void PEQ::process(float* buf, int frames, int channels)
{
    if (m_active == 0) return;  // fast exit if all bands are identity

    for (int f = 0; f < frames; ++f) {
        for (int c = 0; c < channels && c < 2; ++c) {
            float s = buf[f * channels + c];
            // Only iterate active bands using the bitmask
            uint64_t mask = m_active;
            while (mask) {
                int b = __builtin_ctzll(mask);  // count trailing zeros → lowest set bit
                s = m_filters[c][b].tick(s);
                mask &= mask - 1;               // clear lowest set bit
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
    m_active = 0;
}
