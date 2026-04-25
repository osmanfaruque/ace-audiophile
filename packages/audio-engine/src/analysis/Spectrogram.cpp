#include "Spectrogram.h"
#include <cstring>
#include <cmath>
#include <algorithm>
#include <vector>

// KissFFT (A1.4.4)
#include "kiss_fft.h"

static constexpr int   kN    = ACE_FFT_BINS;        // 2048-point FFT
static constexpr float kPi   = 3.14159265358979323846f;
static constexpr float kFloorDb = -120.0f;

Spectrogram::Spectrogram()
{
    m_cfg.fft_size = ACE_FFT_BINS;
    m_cfg.overlap_percent = 50.0f;
    m_cfg.window_type = ACE_FFT_WINDOW_HANN;
    m_cfg.multi_resolution = 0;
}

Spectrogram::~Spectrogram()
{
}

static bool is_power_of_two(uint32_t x)
{
    return x > 0 && (x & (x - 1)) == 0;
}

static void build_window(int fft_size, uint8_t window_type, std::vector<float>& out)
{
    out.assign(static_cast<size_t>(fft_size), 1.0f);
    if (fft_size <= 1) return;

    for (int i = 0; i < fft_size; ++i) {
        const float x = static_cast<float>(i) / static_cast<float>(fft_size - 1);
        if (window_type == ACE_FFT_WINDOW_BLACKMAN) {
            out[static_cast<size_t>(i)] =
                0.42f - 0.5f * std::cos(2.0f * kPi * x) + 0.08f * std::cos(4.0f * kPi * x);
        } else if (window_type == ACE_FFT_WINDOW_KAISER) {
            // Lightweight Kaiser approximation for real-time preview usage.
            const float alpha = 3.0f;
            const float t = 2.0f * x - 1.0f;
            out[static_cast<size_t>(i)] = std::exp(-alpha * t * t);
        } else {
            out[static_cast<size_t>(i)] = 0.5f * (1.0f - std::cos(2.0f * kPi * x));
        }
    }
}

static void run_fft_db(const float* mono, int mono_len, int fft_size,
                       const std::vector<float>& window, std::array<float, ACE_FFT_BINS>& out)
{
    out.fill(kFloorDb);
    if (!mono || mono_len <= 0 || fft_size <= 1) return;

    kiss_fft_cfg cfg = kiss_fft_alloc(fft_size, 0, nullptr, nullptr);
    if (!cfg) return;

    std::vector<kiss_fft_cpx> in(static_cast<size_t>(fft_size));
    std::vector<kiss_fft_cpx> spec(static_cast<size_t>(fft_size));

    const int n = std::min(mono_len, fft_size);
    for (int i = 0; i < n; ++i) {
        const float w = (i < static_cast<int>(window.size())) ? window[static_cast<size_t>(i)] : 1.0f;
        in[static_cast<size_t>(i)].r = mono[i] * w;
        in[static_cast<size_t>(i)].i = 0.0f;
    }
    for (int i = n; i < fft_size; ++i) {
        in[static_cast<size_t>(i)].r = 0.0f;
        in[static_cast<size_t>(i)].i = 0.0f;
    }

    kiss_fft(cfg, in.data(), spec.data());
    kiss_fft_free(cfg);

    const float norm = 1.0f / static_cast<float>(fft_size);
    for (int i = 0; i < std::min(fft_size, ACE_FFT_BINS); ++i) {
        const auto& s = spec[static_cast<size_t>(i)];
        const float mag = std::sqrt(s.r * s.r + s.i * s.i) * norm;
        out[static_cast<size_t>(i)] = (mag > 0.0f) ? std::max(kFloorDb, 20.0f * std::log10(mag)) : kFloorDb;
    }
}

static void blend_multi_res(const float* mono, int mono_len, int fft_size, uint8_t window_type,
                            std::array<float, ACE_FFT_BINS>& out)
{
    std::vector<float> win_primary;
    std::vector<float> win_secondary;
    build_window(fft_size, window_type, win_primary);
    const int secondary_size = std::max(256, fft_size / 2);
    build_window(secondary_size, window_type, win_secondary);

    std::array<float, ACE_FFT_BINS> primary{};
    std::array<float, ACE_FFT_BINS> secondary{};
    run_fft_db(mono, mono_len, fft_size, win_primary, primary);
    run_fft_db(mono, mono_len, secondary_size, win_secondary, secondary);

    for (int i = 0; i < ACE_FFT_BINS; ++i) {
        // Upsample secondary by nearest-bin remap then average in dB space for a stable preview.
        const int sec_idx = static_cast<int>((static_cast<float>(i) / ACE_FFT_BINS) * secondary_size);
        const int safe_sec = std::clamp(sec_idx, 0, ACE_FFT_BINS - 1);
        out[static_cast<size_t>(i)] = 0.5f * (primary[static_cast<size_t>(i)] + secondary[static_cast<size_t>(safe_sec)]);
    }
}

void Spectrogram::compute(const float* pcm, int frames, int channels, int /*sample_rate*/, AceFftFrame& out)
{
    std::memset(&out, 0, sizeof(out));
    if (!pcm || frames <= 0) return;

    AceStftConfig cfg{};
    uint8_t mode = ACE_SPEC_MODE_STEREO;
    {
        std::lock_guard<std::mutex> lk(m_snap_mtx);
        cfg = m_cfg;
        mode = m_channel_mode;
    }

    const int fft_size = std::clamp(static_cast<int>(cfg.fft_size), 256, ACE_FFT_BINS);
    const int n = std::min(frames, fft_size);

    std::vector<float> left(static_cast<size_t>(fft_size), 0.0f);
    std::vector<float> right(static_cast<size_t>(fft_size), 0.0f);
    std::vector<float> mid(static_cast<size_t>(fft_size), 0.0f);
    std::vector<float> side(static_cast<size_t>(fft_size), 0.0f);
    std::vector<float> mono(static_cast<size_t>(fft_size), 0.0f);

    constexpr float kInvSqrt2 = 0.70710678118f;
    for (int i = 0; i < n; ++i) {
        const float l = pcm[i * channels + 0];
        const float r = (channels > 1) ? pcm[i * channels + 1] : l;
        left[static_cast<size_t>(i)] = l;
        right[static_cast<size_t>(i)] = r;
        mid[static_cast<size_t>(i)] = (l + r) * kInvSqrt2;
        side[static_cast<size_t>(i)] = (l - r) * kInvSqrt2;
        mono[static_cast<size_t>(i)] = 0.5f * (l + r);
    }

    std::array<float, ACE_FFT_BINS> a{};
    std::array<float, ACE_FFT_BINS> b{};
    a.fill(kFloorDb);
    b.fill(kFloorDb);

    if (mode == ACE_SPEC_MODE_MID_SIDE) {
        if (cfg.multi_resolution) {
            blend_multi_res(mid.data(), n, fft_size, cfg.window_type, a);
            blend_multi_res(side.data(), n, fft_size, cfg.window_type, b);
        } else {
            std::vector<float> win;
            build_window(fft_size, cfg.window_type, win);
            run_fft_db(mid.data(), n, fft_size, win, a);
            run_fft_db(side.data(), n, fft_size, win, b);
        }
    } else if (mode == ACE_SPEC_MODE_MERGED) {
        if (cfg.multi_resolution) {
            blend_multi_res(mono.data(), n, fft_size, cfg.window_type, a);
        } else {
            std::vector<float> win;
            build_window(fft_size, cfg.window_type, win);
            run_fft_db(mono.data(), n, fft_size, win, a);
        }
        b = a;
    } else {
        if (cfg.multi_resolution) {
            blend_multi_res(left.data(), n, fft_size, cfg.window_type, a);
            blend_multi_res(right.data(), n, fft_size, cfg.window_type, b);
        } else {
            std::vector<float> win;
            build_window(fft_size, cfg.window_type, win);
            run_fft_db(left.data(), n, fft_size, win, a);
            run_fft_db(right.data(), n, fft_size, win, b);
        }
    }

    std::memcpy(out.bins_l, a.data(), sizeof(out.bins_l));
    std::memcpy(out.bins_r, b.data(), sizeof(out.bins_r));
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

    std::array<float, ACE_FFT_BINS> ch0{};
    std::array<float, ACE_FFT_BINS> ch1{};
    std::memcpy(ch0.data(), fft.bins_l, sizeof(fft.bins_l));
    std::memcpy(ch1.data(), fft.bins_r, sizeof(fft.bins_r));

    m_ring_ch0.push_back(ch0);
    m_ring_ch1.push_back(ch1);
    if (static_cast<int>(m_ring_ch0.size()) > kRingCapacity) m_ring_ch0.pop_front();
    if (static_cast<int>(m_ring_ch1.size()) > kRingCapacity) m_ring_ch1.pop_front();
}

int Spectrogram::set_stft_config(const AceStftConfig& cfg)
{
    if (cfg.fft_size < 256 || cfg.fft_size > ACE_FFT_BINS || !is_power_of_two(cfg.fft_size)) {
        return -1;
    }
    if (cfg.overlap_percent < 0.0f || cfg.overlap_percent >= 95.0f) {
        return -2;
    }
    if (cfg.window_type > ACE_FFT_WINDOW_KAISER) {
        return -3;
    }

    std::lock_guard<std::mutex> lk(m_snap_mtx);
    m_cfg = cfg;
    return 0;
}

int Spectrogram::set_channel_mode(uint8_t mode)
{
    if (mode > ACE_SPEC_MODE_MERGED) return -1;
    std::lock_guard<std::mutex> lk(m_snap_mtx);
    m_channel_mode = mode;
    return 0;
}

int Spectrogram::get_channel_ring(uint8_t channel_index, float* out_bins,
                                  int max_frames, int* out_frames, int* out_bins_per_frame) const
{
    if (!out_bins || !out_frames || !out_bins_per_frame || max_frames <= 0) return -1;

    std::lock_guard<std::mutex> lk(m_snap_mtx);
    const auto& ring = (channel_index == 0) ? m_ring_ch0 : m_ring_ch1;
    const int frame_count = std::min(max_frames, static_cast<int>(ring.size()));
    const int start = static_cast<int>(ring.size()) - frame_count;

    for (int i = 0; i < frame_count; ++i) {
        const auto& frame = ring[static_cast<size_t>(start + i)];
        std::memcpy(out_bins + (i * ACE_FFT_BINS), frame.data(), sizeof(float) * ACE_FFT_BINS);
    }

    *out_frames = frame_count;
    *out_bins_per_frame = ACE_FFT_BINS;
    return 0;
}
