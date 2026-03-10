#pragma once
#include "ace_engine.h"
#include "PEQ.h"
#include "Crossfeed.h"
#include "Dither.h"
#include "Resampler.h"

class DspChain {
public:
    void apply(const AceDspState& state);
    void set_sample_rate(float sr);
    void set_eq_band(int index, float freq_hz, float gain_db, float q,
                     bool enabled, uint8_t filter_type);
    // process() is called on the audio thread with interleaved PCM float32 samples
    void process(float* buf, int frames, int channels);
private:
    AceDspState m_state{};
    PEQ         m_peq;
    Crossfeed   m_crossfeed;
    Dither      m_dither;
    float       m_sample_rate{44100.0f};
    bool        m_configured{false};
};
