/**
 * test_peq.cpp — A1.5.2: PEQ known frequency response verification (sweep signal)
 *
 * Generates a logarithmic sine sweep through the PEQ, measures the output
 * level at key frequencies, and verifies the frequency response matches
 * the expected biquad filter shape within tight tolerances.
 */

#include <gtest/gtest.h>
#include "dsp/PEQ.h"
#include "ace_engine.h"

#include <array>
#include <cmath>
#include <cstring>
#include <vector>

namespace {

static constexpr double kPi = 3.14159265358979323846;
static constexpr float  kSR = 48000.0f;

// Measure the gain of a PEQ at a specific frequency by feeding a burst of
// sine and comparing RMS output to input.
float measure_gain_db(PEQ& peq, float freq_hz, float sample_rate,
                      int channels) {
    const int kCycles   = 200;   // enough cycles to reach steady-state
    const int kSettle   = 80;    // discard this many cycles for transient
    const int kMeasure  = kCycles - kSettle;
    const int frames_per_cycle = static_cast<int>(sample_rate / freq_hz);
    const int total_frames     = kCycles * frames_per_cycle;

    std::vector<float> buf(total_frames * channels);

    // Generate pure sine tone (same on all channels)
    for (int f = 0; f < total_frames; ++f) {
        float val = std::sin(2.0 * kPi * freq_hz * f / sample_rate);
        for (int c = 0; c < channels; ++c)
            buf[f * channels + c] = val;
    }

    // Process through PEQ
    peq.process(buf.data(), total_frames, channels);

    // Measure RMS of post-settle portion (channel 0)
    int start = kSettle * frames_per_cycle;
    int end   = total_frames;
    double sum_sq = 0.0;
    int count = 0;
    for (int f = start; f < end; ++f) {
        double s = buf[f * channels]; // channel 0
        sum_sq += s * s;
        ++count;
    }
    double rms_out = std::sqrt(sum_sq / count);

    // Input RMS of a sine = 1/sqrt(2) ≈ 0.7071
    double rms_in = 1.0 / std::sqrt(2.0);

    if (rms_out < 1e-12) return -120.0f;
    return static_cast<float>(20.0 * std::log10(rms_out / rms_in));
}

} // anonymous namespace

// ─────────────────────────────────────────────────────────────────────────────
// A1.5.2 — PEQ: known frequency response verification (sweep signal)
// ─────────────────────────────────────────────────────────────────────────────

class PeqSweepTest : public ::testing::Test {
protected:
    PEQ peq;
};

// Test 1: Flat response when all bands are disabled (unity gain)
TEST_F(PeqSweepTest, FlatWhenAllDisabled) {
    AceEqBand bands[ACE_EQ_BANDS]{};
    peq.configure(bands, kSR);

    // Measure at several frequencies — should all be ~0 dB
    float freqs[] = {100.0f, 1000.0f, 5000.0f, 15000.0f};
    for (float f : freqs) {
        peq.reset();
        peq.configure(bands, kSR);
        float gain = measure_gain_db(peq, f, kSR, 2);
        EXPECT_NEAR(gain, 0.0f, 0.1f)
            << "Expected flat response at " << f << " Hz, got " << gain << " dB";
    }
}

// Test 2: Single peaking band at 1 kHz, +6 dB, Q=1
TEST_F(PeqSweepTest, SinglePeakingBand) {
    AceEqBand bands[ACE_EQ_BANDS]{};
    bands[0].freq_hz    = 1000.0f;
    bands[0].gain_db    = 6.0f;
    bands[0].q          = 1.0f;
    bands[0].enabled    = 1;
    bands[0].filter_type = ACE_FILTER_PEAKING;

    peq.configure(bands, kSR);

    // At center frequency (1 kHz) → should be approximately +6 dB
    float gain_center = measure_gain_db(peq, 1000.0f, kSR, 2);
    EXPECT_NEAR(gain_center, 6.0f, 0.3f)
        << "Peaking filter center should be +6 dB";

    // Far below center (100 Hz) → should be near 0 dB
    peq.reset();
    peq.configure(bands, kSR);
    float gain_low = measure_gain_db(peq, 100.0f, kSR, 2);
    EXPECT_NEAR(gain_low, 0.0f, 0.5f)
        << "Far below center should be near unity";

    // Far above center (15 kHz) → should be near 0 dB
    peq.reset();
    peq.configure(bands, kSR);
    float gain_high = measure_gain_db(peq, 15000.0f, kSR, 2);
    EXPECT_NEAR(gain_high, 0.0f, 0.5f)
        << "Far above center should be near unity";
}

// Test 3: Single peaking band with negative gain (cut)
TEST_F(PeqSweepTest, PeakingCut) {
    AceEqBand bands[ACE_EQ_BANDS]{};
    bands[0].freq_hz    = 4000.0f;
    bands[0].gain_db    = -10.0f;
    bands[0].q          = 2.0f;
    bands[0].enabled    = 1;
    bands[0].filter_type = ACE_FILTER_PEAKING;

    peq.configure(bands, kSR);
    float gain_center = measure_gain_db(peq, 4000.0f, kSR, 2);
    EXPECT_NEAR(gain_center, -10.0f, 0.5f)
        << "Peaking cut at center should be -10 dB";
}

// Test 4: Low-shelf filter at 200 Hz, +4 dB
TEST_F(PeqSweepTest, LowShelfBoost) {
    AceEqBand bands[ACE_EQ_BANDS]{};
    bands[0].freq_hz    = 200.0f;
    bands[0].gain_db    = 4.0f;
    bands[0].q          = 0.707f;
    bands[0].enabled    = 1;
    bands[0].filter_type = ACE_FILTER_LOW_SHELF;

    peq.configure(bands, kSR);

    // Well below shelf freq → should see full boost (~+4 dB)
    float gain_low = measure_gain_db(peq, 50.0f, kSR, 2);
    EXPECT_NEAR(gain_low, 4.0f, 0.5f)
        << "Low shelf should boost frequencies well below corner";

    // Well above shelf freq → near unity
    peq.reset();
    peq.configure(bands, kSR);
    float gain_high = measure_gain_db(peq, 10000.0f, kSR, 2);
    EXPECT_NEAR(gain_high, 0.0f, 0.3f)
        << "Low shelf should not affect high frequencies";
}

// Test 5: High-shelf filter at 8 kHz, +5 dB
TEST_F(PeqSweepTest, HighShelfBoost) {
    AceEqBand bands[ACE_EQ_BANDS]{};
    bands[0].freq_hz    = 8000.0f;
    bands[0].gain_db    = 5.0f;
    bands[0].q          = 0.707f;
    bands[0].enabled    = 1;
    bands[0].filter_type = ACE_FILTER_HIGH_SHELF;

    peq.configure(bands, kSR);

    // Well above shelf freq → full boost
    float gain_high = measure_gain_db(peq, 20000.0f, kSR, 2);
    EXPECT_NEAR(gain_high, 5.0f, 0.5f)
        << "High shelf should boost above corner";

    // Well below shelf freq → near unity
    peq.reset();
    peq.configure(bands, kSR);
    float gain_low = measure_gain_db(peq, 200.0f, kSR, 2);
    EXPECT_NEAR(gain_low, 0.0f, 0.3f)
        << "High shelf should not affect low frequencies";
}

// Test 6: Low-pass filter at 2 kHz — heavy attenuation above
TEST_F(PeqSweepTest, LowPassFilter) {
    AceEqBand bands[ACE_EQ_BANDS]{};
    bands[0].freq_hz    = 2000.0f;
    bands[0].gain_db    = 0.0f;
    bands[0].q          = 0.707f;
    bands[0].enabled    = 1;
    bands[0].filter_type = ACE_FILTER_LOW_PASS;

    peq.configure(bands, kSR);

    // Well below cutoff → pass through (~0 dB)
    float gain_low = measure_gain_db(peq, 200.0f, kSR, 2);
    EXPECT_NEAR(gain_low, 0.0f, 0.3f)
        << "LPF should pass below cutoff";

    // At cutoff (Q=0.707) → ~-3 dB
    peq.reset();
    peq.configure(bands, kSR);
    float gain_fc = measure_gain_db(peq, 2000.0f, kSR, 2);
    EXPECT_NEAR(gain_fc, -3.0f, 0.5f)
        << "LPF -3 dB at cutoff";

    // 1 octave above cutoff → ~-12 dB (2nd order = 12 dB/oct)
    peq.reset();
    peq.configure(bands, kSR);
    float gain_above = measure_gain_db(peq, 8000.0f, kSR, 2);
    EXPECT_LT(gain_above, -10.0f)
        << "LPF should attenuate well above cutoff";
}

// Test 7: Multiple active bands — verify combined response
TEST_F(PeqSweepTest, MultiBandCombined) {
    AceEqBand bands[ACE_EQ_BANDS]{};
    // Band 0: boost at 200 Hz
    bands[0].freq_hz = 200.0f;  bands[0].gain_db = 3.0f;
    bands[0].q = 1.0f;          bands[0].enabled = 1;
    bands[0].filter_type = ACE_FILTER_PEAKING;
    // Band 1: boost at 4 kHz
    bands[1].freq_hz = 4000.0f; bands[1].gain_db = 6.0f;
    bands[1].q = 1.0f;          bands[1].enabled = 1;
    bands[1].filter_type = ACE_FILTER_PEAKING;

    peq.configure(bands, kSR);

    float gain_200  = measure_gain_db(peq, 200.0f, kSR, 2);
    EXPECT_NEAR(gain_200, 3.0f, 0.5f);

    peq.reset();
    peq.configure(bands, kSR);
    float gain_4k   = measure_gain_db(peq, 4000.0f, kSR, 2);
    EXPECT_NEAR(gain_4k, 6.0f, 0.5f);

    // 1 kHz should be roughly between (affected slightly by both band tails)
    peq.reset();
    peq.configure(bands, kSR);
    float gain_1k = measure_gain_db(peq, 1000.0f, kSR, 2);
    EXPECT_GT(gain_1k, -1.0f);
    EXPECT_LT(gain_1k, 3.0f);
}

// Test 8: Notch filter — deep null at center
TEST_F(PeqSweepTest, NotchFilter) {
    AceEqBand bands[ACE_EQ_BANDS]{};
    bands[0].freq_hz    = 1000.0f;
    bands[0].gain_db    = 0.0f;
    bands[0].q          = 10.0f;  // narrow notch
    bands[0].enabled    = 1;
    bands[0].filter_type = ACE_FILTER_NOTCH;

    peq.configure(bands, kSR);

    float gain_notch = measure_gain_db(peq, 1000.0f, kSR, 2);
    EXPECT_LT(gain_notch, -30.0f)
        << "Notch filter should have deep null at center frequency";

    // Away from notch → near unity
    peq.reset();
    peq.configure(bands, kSR);
    float gain_away = measure_gain_db(peq, 5000.0f, kSR, 2);
    EXPECT_NEAR(gain_away, 0.0f, 0.5f)
        << "Notch should not affect distant frequencies";
}

// Test 9: Stereo independence — both channels processed equally
TEST_F(PeqSweepTest, StereoChannelsMatch) {
    AceEqBand bands[ACE_EQ_BANDS]{};
    bands[0].freq_hz = 1000.0f;  bands[0].gain_db = 6.0f;
    bands[0].q = 1.0f;           bands[0].enabled = 1;
    bands[0].filter_type = ACE_FILTER_PEAKING;

    peq.configure(bands, kSR);

    // Generate stereo sine
    const int frames = 8000;
    std::vector<float> buf(frames * 2);
    for (int i = 0; i < frames; ++i) {
        float val = std::sin(2.0 * kPi * 1000.0 * i / kSR);
        buf[i * 2 + 0] = val;
        buf[i * 2 + 1] = val;
    }
    peq.process(buf.data(), frames, 2);

    // Verify L and R are identical after processing
    for (int i = 4000; i < frames; ++i) {  // skip settle
        EXPECT_FLOAT_EQ(buf[i * 2 + 0], buf[i * 2 + 1])
            << "L/R mismatch at frame " << i;
    }
}
