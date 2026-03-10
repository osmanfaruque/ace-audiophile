#include "DspChain.h"
#include <cmath>
#include <algorithm>

void DspChain::apply(const AceDspState& state)
{
    m_state = state;

    // Pre-amp
    m_preamp.set_gain_db(state.preamp_db);

    // PEQ
    if (state.eq_enabled)
        m_peq.configure(state.bands, m_sample_rate);
    else
        m_peq.reset();

    // Crossfeed
    m_crossfeed.set_strength(state.crossfeed_enabled ? state.crossfeed_strength : 0.0f);

    // Dither
    if (state.dither_enabled)
        m_dither.configure(state.dither_bits);

    m_configured = true;
}

void DspChain::set_sample_rate(float sr)
{
    m_sample_rate = sr;
    if (m_configured && m_state.eq_enabled)
        m_peq.configure(m_state.bands, m_sample_rate);
}

void DspChain::set_eq_band(int index, float freq_hz, float gain_db, float q,
                           bool enabled, uint8_t filter_type)
{
    if (index < 0 || index >= ACE_EQ_BANDS) return;
    m_state.bands[index].freq_hz     = freq_hz;
    m_state.bands[index].gain_db     = gain_db;
    m_state.bands[index].q           = q;
    m_state.bands[index].enabled     = enabled ? 1 : 0;
    m_state.bands[index].filter_type = filter_type;
    if (m_state.eq_enabled)
        m_peq.configure(m_state.bands, m_sample_rate);
}

void DspChain::process(float* buf, int frames, int channels)
{
    if (!m_configured) return;

    // 1. Pre-amp gain stage with clip detection (A1.3.2)
    m_preamp.process(buf, frames, channels);

    // 2. Parametric EQ (60-band biquad IIR)
    if (m_state.eq_enabled)
        m_peq.process(buf, frames, channels);

    // 3. Crossfeed (Bauer stereo-to-binaural)
    if (m_state.crossfeed_enabled)
        m_crossfeed.process(buf, frames, channels);

    // 4. Dither (TPDF) — applied last before output
    if (m_state.dither_enabled)
        m_dither.process(buf, frames, channels);

    // Clip guard: clamp to [-1.0, 1.0]
    int total = frames * channels;
    for (int i = 0; i < total; ++i)
        buf[i] = std::clamp(buf[i], -1.0f, 1.0f);
}
