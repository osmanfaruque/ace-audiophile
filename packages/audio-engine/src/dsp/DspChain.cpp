#include "DspChain.h"
#include <cmath>
#include <algorithm>

void DspChain::apply(const AceDspState& state)
{
    m_state = state;

    // ReplayGain — loudness normalization + true-peak limiter (A1.3.7)
    m_replay_gain.configure(
        static_cast<ReplayGain::Mode>(state.rg_mode),
        state.rg_track_gain, state.rg_album_gain,
        state.rg_track_peak, state.rg_album_peak,
        state.rg_pre_amp, state.rg_ceiling_db, m_sample_rate);

    // Pre-amp
    m_preamp.set_gain_db(state.preamp_db);

    // PEQ
    if (state.eq_enabled)
        m_peq.configure(state.bands, m_sample_rate);
    else
        m_peq.reset();

    // Crossfeed (Bauer BS2B)
    m_crossfeed.configure(state.crossfeed_enabled ? state.crossfeed_strength : 0.0f, m_sample_rate);

    // Spatializer — virtual surround (A1.3.6)
    m_spatializer.configure(state.spatializer_enabled ? state.spatializer_strength : 0.0f,
                            m_sample_rate);

    // Convolver — FIR impulse response (A1.3.9)
    // IR loading is handled separately via load_ir(); configure is a no-op here.

    // Channel mixer (A1.3.10)
    if (state.mixer_enabled)
        m_channel_mixer.configure(state.mixer_swap_lr != 0,
                                  state.mixer_mono != 0,
                                  state.mixer_balance,
                                  state.mixer_invert_l != 0,
                                  state.mixer_invert_r != 0);
    else
        m_channel_mixer.configure(false, false, 0.0f, false, false);

    // Resampler (libsoxr VHQ)
    if (state.resampler_enabled && state.resampler_target_hz > 0)
        m_resampler.configure(static_cast<uint32_t>(m_sample_rate),
                              state.resampler_target_hz, 2);
    else
        m_resampler.configure(static_cast<uint32_t>(m_sample_rate),
                              static_cast<uint32_t>(m_sample_rate), 2); // passthrough

    // Dither (TPDF + noise shaping)
    if (state.dither_enabled)
        m_dither.configure(state.dither_bits, state.dither_noise_shaping != 0);

    // Limiter + anti-clip guard (A1.3.8)
    m_limiter.configure(state.limiter_enabled != 0,
                        state.limiter_ceiling_db,
                        state.limiter_release_ms,
                        m_sample_rate);

    m_configured = true;
}

void DspChain::set_sample_rate(float sr)
{
    m_sample_rate = sr;
    if (m_configured && m_state.eq_enabled)
        m_peq.configure(m_state.bands, m_sample_rate);
    if (m_configured && m_state.crossfeed_enabled)
        m_crossfeed.configure(m_state.crossfeed_strength, m_sample_rate);
    if (m_configured && m_state.spatializer_enabled)
        m_spatializer.configure(m_state.spatializer_strength, m_sample_rate);
    if (m_configured && m_state.resampler_enabled && m_state.resampler_target_hz > 0)
        m_resampler.configure(static_cast<uint32_t>(m_sample_rate),
                              m_state.resampler_target_hz, 2);
}

float DspChain::output_sample_rate() const
{
    if (m_state.resampler_enabled && m_resampler.active())
        return static_cast<float>(m_resampler.output_rate());
    return m_sample_rate;
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

int DspChain::process(float* buf, int frames, int channels)
{
    if (!m_configured) {
        m_last_output = nullptr;
        return frames;
    }

    // 0. ReplayGain — loudness normalization + true-peak limiter (A1.3.7)
    m_replay_gain.process(buf, frames, channels);

    // 1. Pre-amp gain stage with clip detection (A1.3.2)
    m_preamp.process(buf, frames, channels);

    // 2. Parametric EQ (60-band biquad IIR)
    if (m_state.eq_enabled)
        m_peq.process(buf, frames, channels);

    // 3. Crossfeed (Bauer stereo-to-binaural)
    if (m_state.crossfeed_enabled)
        m_crossfeed.process(buf, frames, channels);

    // 3b. Spatializer — virtual surround (A1.3.6)
    if (m_state.spatializer_enabled)
        m_spatializer.process(buf, frames, channels);

    // 3c. Convolver — FIR impulse response (A1.3.9)
    if (m_convolver.active())
        m_convolver.process(buf, frames, channels);

    // 3d. Channel mixer (A1.3.10)
    if (m_state.mixer_enabled)
        m_channel_mixer.process(buf, frames, channels);

    // 4. Resampler — libsoxr polyphase (A1.3.4)
    //    May change frame count; output goes to internal buffer.
    int    out_frames = frames;
    float* out_ptr    = buf;

    if (m_state.resampler_enabled && m_resampler.active()) {
        int max_out = m_resampler.max_output_frames(frames);
        m_resample_buf.resize(static_cast<size_t>(max_out * channels));
        out_frames = m_resampler.process(buf, frames,
                                         m_resample_buf.data(), max_out);
        out_ptr = m_resample_buf.data();
    }

    // 5. Dither (TPDF) — applied to (potentially resampled) output
    if (m_state.dither_enabled)
        m_dither.process(out_ptr, out_frames, channels);

    // 6. Limiter + anti-clip guard (A1.3.8)
    m_limiter.process(out_ptr, out_frames, channels);

    m_last_output = (out_ptr != buf) ? out_ptr : nullptr;
    return out_frames;
}
