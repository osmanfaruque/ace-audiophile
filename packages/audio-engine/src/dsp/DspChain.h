#pragma once
#include "ace_engine.h"
#include "PEQ.h"
#include "PreAmp.h"
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

    PreAmp&       preamp()       { return m_preamp; }
    const PreAmp& preamp() const { return m_preamp; }
private:
    AceDspState m_state{};
    PreAmp      m_preamp;
    PEQ         m_peq;
    Crossfeed   m_crossfeed;
    Dither      m_dither;
    float       m_sample_rate{44100.0f};
    bool        m_configured{false};
};
