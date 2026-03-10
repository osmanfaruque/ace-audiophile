#include "Resampler.h"
#include <soxr.h>
#include <cmath>
#include <algorithm>

Resampler::~Resampler() { destroy(); }

void Resampler::destroy()
{
    if (m_soxr) {
        soxr_delete(static_cast<soxr_t>(m_soxr));
        m_soxr = nullptr;
    }
    m_active = false;
}

bool Resampler::configure(uint32_t in_hz, uint32_t out_hz, int channels)
{
    destroy();

    m_in_hz    = in_hz;
    m_out_hz   = out_hz;
    m_channels = channels;

    if (in_hz == out_hz || in_hz == 0 || out_hz == 0) {
        m_active = false;
        return true; // passthrough — no soxr instance needed
    }

    soxr_error_t       err;
    soxr_io_spec_t     io  = soxr_io_spec(SOXR_FLOAT32_I, SOXR_FLOAT32_I);
    soxr_quality_spec_t qs = soxr_quality_spec(SOXR_VHQ, 0);          // audiophile VHQ
    soxr_runtime_spec_t rs = soxr_runtime_spec(1);                     // single-thread

    soxr_t s = soxr_create(
        static_cast<double>(in_hz),
        static_cast<double>(out_hz),
        static_cast<unsigned>(channels),
        &err, &io, &qs, &rs);

    if (err || !s) {
        m_soxr   = nullptr;
        m_active = false;
        return false;
    }

    m_soxr   = s;
    m_active = true;
    return true;
}

int Resampler::process(const float* in, int in_frames, float* out, int out_cap)
{
    if (!m_active || !m_soxr) return 0;

    size_t in_done = 0, out_done = 0;
    soxr_process(static_cast<soxr_t>(m_soxr),
                 in,  static_cast<size_t>(in_frames),  &in_done,
                 out, static_cast<size_t>(out_cap),    &out_done);
    return static_cast<int>(out_done);
}

int Resampler::flush(float* out, int out_cap)
{
    if (!m_active || !m_soxr) return 0;

    size_t out_done = 0;
    soxr_process(static_cast<soxr_t>(m_soxr),
                 nullptr, 0, nullptr,
                 out, static_cast<size_t>(out_cap), &out_done);
    return static_cast<int>(out_done);
}

void Resampler::reset()
{
    if (m_active && m_in_hz && m_out_hz)
        configure(m_in_hz, m_out_hz, m_channels);
}

double Resampler::ratio() const
{
    if (m_in_hz == 0) return 1.0;
    return static_cast<double>(m_out_hz) / static_cast<double>(m_in_hz);
}

int Resampler::max_output_frames(int in_frames) const
{
    return static_cast<int>(std::ceil(in_frames * ratio())) + 32;
}
