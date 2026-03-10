#pragma once
#include "ace_engine.h"
#include "PEQ.h"
#include "PreAmp.h"
#include "Crossfeed.h"
#include "Dither.h"
#include "Resampler.h"
#include <vector>

class DspChain {
public:
    void apply(const AceDspState& state);
    void set_sample_rate(float sr);
    void set_eq_band(int index, float freq_hz, float gain_db, float q,
                     bool enabled, uint8_t filter_type);

    /** Process audio through the DSP chain.
     *  @return number of output frames (may differ from @p frames when resampler is active). */
    int process(float* buf, int frames, int channels);

    /** After process(), returns pointer to output data.
     *  When resampler is inactive this returns @p original_buf.
     *  When resampler is active this returns an internal buffer. */
    float* last_output(float* original_buf) const
    { return m_last_output ? m_last_output : original_buf; }

    /** Effective output sample rate (after resampler). */
    float output_sample_rate() const;

    PreAmp&       preamp()       { return m_preamp; }
    const PreAmp& preamp() const { return m_preamp; }

    Resampler&       resampler()       { return m_resampler; }
    const Resampler& resampler() const { return m_resampler; }

private:
    AceDspState m_state{};
    PreAmp      m_preamp;
    PEQ         m_peq;
    Crossfeed   m_crossfeed;
    Resampler   m_resampler;
    Dither      m_dither;
    float       m_sample_rate{44100.0f};
    bool        m_configured{false};

    // Internal buffer for resampled output
    std::vector<float> m_resample_buf;
    float*             m_last_output{nullptr};
};
