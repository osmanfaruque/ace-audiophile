#include "Spectrogram.h"
#include <cstring>
#include <cmath>
#include <algorithm>

// KissFFT (A1.4.4)
#include "kiss_fft.h"

static constexpr int   kN    = ACE_FFT_BINS;        // 2048-point FFT
static constexpr float kPi   = 3.14159265358979323846f;
static constexpr float kFloorDb = -120.0f;

Spectrogram::Spectrogram()
{
    m_cfg = kiss_fft_alloc(kN, 0/*forward*/, nullptr, nullptr);

    // Pre-compute Hann window
    for (int i = 0; i < kN; ++i)
        m_window[i] = 0.5f * (1.0f - std::cos(2.0f * kPi * i / (kN - 1)));
}

Spectrogram::~Spectrogram()
{
    if (m_cfg) kiss_fft_free(m_cfg);
}

void Spectrogram::compute(const float* pcm, int frames, int /*sample_rate*/, AceFftFrame& out)
{
    std::memset(&out, 0, sizeof(out));
    if (!pcm || frames <= 0 || !m_cfg) return;

    // Use up to kN frames (zero-pad if less)
    const int n = std::min(frames, kN);

    // Deinterleave into per-channel windowed buffers
    kiss_fft_cpx in_l[kN]{};
    kiss_fft_cpx in_r[kN]{};
    kiss_fft_cpx out_l[kN]{};
    kiss_fft_cpx out_r[kN]{};

    for (int i = 0; i < n; ++i) {
        in_l[i].r = pcm[i * 2 + 0] * m_window[i];
        in_l[i].i = 0.0f;
        in_r[i].r = pcm[i * 2 + 1] * m_window[i];
        in_r[i].i = 0.0f;
    }
    // Remaining samples are already zero-initialized

    kiss_fft(m_cfg, in_l, out_l);
    kiss_fft(m_cfg, in_r, out_r);

    // Convert to dB magnitude (only first N/2+1 bins are unique for real input)
    const float norm = 1.0f / kN;
    for (int i = 0; i < kN; ++i) {
        float mag_l = std::sqrt(out_l[i].r * out_l[i].r + out_l[i].i * out_l[i].i) * norm;
        float mag_r = std::sqrt(out_r[i].r * out_r[i].r + out_r[i].i * out_r[i].i) * norm;
        // 20*log10(mag), floored
        out.bins_l[i] = (mag_l > 0.0f) ? std::max(kFloorDb, 20.0f * std::log10(mag_l)) : kFloorDb;
        out.bins_r[i] = (mag_r > 0.0f) ? std::max(kFloorDb, 20.0f * std::log10(mag_r)) : kFloorDb;
    }
}

void Spectrogram::compute_levels(const float* pcm, int frames, int channels, AceLevelMeter& out)
{
    std::memset(&out, 0, sizeof(out));
    if (!pcm || frames <= 0 || channels < 1) return;

    float peak_l = 0.0f, peak_r = 0.0f;
    double sum_sq_l = 0.0, sum_sq_r = 0.0;

    for (int i = 0; i < frames; ++i) {
        float l = std::fabs(pcm[i * channels]);
        if (l > peak_l) peak_l = l;
        sum_sq_l += static_cast<double>(l) * l;

        if (channels >= 2) {
            float r = std::fabs(pcm[i * channels + 1]);
            if (r > peak_r) peak_r = r;
            sum_sq_r += static_cast<double>(r) * r;
        }
    }

    auto to_db = [](float v) -> float {
        return (v > 1e-10f) ? 20.0f * std::log10(v) : -200.0f;
    };

    out.peak_l_db = to_db(peak_l);
    out.peak_r_db = to_db(peak_r);
    out.rms_l_db  = to_db(static_cast<float>(std::sqrt(sum_sq_l / frames)));
    out.rms_r_db  = (channels >= 2)
                  ? to_db(static_cast<float>(std::sqrt(sum_sq_r / frames)))
                  : out.rms_l_db;
    // LUFS requires full K-weighted loudness filter chain — placeholder uses RMS approximation
    float avg_rms = 0.5f * (out.rms_l_db + out.rms_r_db);
    out.lufs_integrated = avg_rms - 0.691f;  // rough K-weight offset
}

void Spectrogram::get_last(AceFftFrame& fft, AceLevelMeter& lvl) const
{
    std::lock_guard<std::mutex> lk(m_snap_mtx);
    fft = m_last_fft;
    lvl = m_last_lvl;
}

void Spectrogram::store_last(const AceFftFrame& fft, const AceLevelMeter& lvl)
{
    std::lock_guard<std::mutex> lk(m_snap_mtx);
    m_last_fft = fft;
    m_last_lvl = lvl;
}
