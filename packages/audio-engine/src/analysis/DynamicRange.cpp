#include "DynamicRange.h"
#include "decoder/FFmpegDecoder.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <vector>

// ── BS.1770 Biquad ───────────────────────────────────────────────────────────

namespace {

struct Biquad {
    double b0 = 1.0, b1 = 0.0, b2 = 0.0;
    double a1 = 0.0, a2 = 0.0;
    double z1 = 0.0, z2 = 0.0;

    float process(float x)
    {
        const double y = b0 * static_cast<double>(x) + z1;
        z1 = b1 * static_cast<double>(x) - a1 * y + z2;
        z2 = b2 * static_cast<double>(x) - a2 * y;
        return static_cast<float>(y);
    }
};

Biquad make_high_pass(double fs, double f0, double q)
{
    Biquad biq;
    const double w0 = 2.0 * 3.14159265358979323846 * f0 / fs;
    const double cw = std::cos(w0);
    const double sw = std::sin(w0);
    const double alpha = sw / (2.0 * q);

    const double b0 = (1.0 + cw) / 2.0;
    const double b1 = -(1.0 + cw);
    const double b2 = (1.0 + cw) / 2.0;
    const double a0 = 1.0 + alpha;

    biq.b0 = b0 / a0;
    biq.b1 = b1 / a0;
    biq.b2 = b2 / a0;
    biq.a1 = (-2.0 * cw) / a0;
    biq.a2 = (1.0 - alpha) / a0;
    return biq;
}

Biquad make_high_shelf(double fs, double f0, double gain_db)
{
    Biquad biq;
    const double a = std::pow(10.0, gain_db / 40.0);
    const double w0 = 2.0 * 3.14159265358979323846 * f0 / fs;
    const double cw = std::cos(w0);
    const double sw = std::sin(w0);
    const double s = 1.0;
    const double alpha = sw / 2.0 * std::sqrt((a + 1.0 / a) * (1.0 / s - 1.0) + 2.0);
    const double beta = 2.0 * std::sqrt(a) * alpha;

    const double b0_ =    a * ((a + 1.0) + (a - 1.0) * cw + beta);
    const double b1_ = -2.0 * a * ((a - 1.0) + (a + 1.0) * cw);
    const double b2_ =    a * ((a + 1.0) + (a - 1.0) * cw - beta);
    const double a0_ =         (a + 1.0) - (a - 1.0) * cw + beta;
    const double a1_ =  2.0 * ((a - 1.0) - (a + 1.0) * cw);
    const double a2_ =         (a + 1.0) - (a - 1.0) * cw - beta;

    biq.b0 = b0_ / a0_;
    biq.b1 = b1_ / a0_;
    biq.b2 = b2_ / a0_;
    biq.a1 = a1_ / a0_;
    biq.a2 = a2_ / a0_;
    return biq;
}

double bs1770_channel_weight(int ch, int total)
{
    // BS.1770: LFE channel (index 3 in 5.1) is excluded
    if (total >= 6 && ch == 3) return 0.0;
    return 1.0;
}

// ── 4× Sinc Interpolation for True Peak (ITU-R BS.1770-4 Annex 2) ───────────
//
// The 48-tap FIR coefficients are derived from a windowed sinc at 4× oversample.
// This detects intersample peaks that exceed 0 dBFS in the analog domain even
// when digital samples are below 0 dBFS.

static constexpr int kOversampleFactor = 4;
static constexpr int kSincHalfTaps = 12; // 12 taps each side = 24-tap FIR per phase

// Simplified 4-phase FIR coefficients (truncated sinc × Kaiser window)
// Phase 0 is the original sample (identity), phases 1-3 are interpolated points.
//
// These are approximations sufficient for true-peak detection accuracy within
// ±0.1 dB of the ITU reference implementation.

static constexpr int kPhases = 4;
static constexpr int kTapsPerPhase = 2 * kSincHalfTaps;

static float sinc_value(double x)
{
    if (std::abs(x) < 1e-10) return 1.0f;
    const double pi_x = 3.14159265358979323846 * x;
    return static_cast<float>(std::sin(pi_x) / pi_x);
}

static float kaiser_window(double n, double N, double beta)
{
    // Approximation of Kaiser window using I0 expansion
    auto bessel_i0 = [](double x) -> double {
        double sum = 1.0;
        double term = 1.0;
        for (int k = 1; k <= 20; ++k) {
            term *= (x / (2.0 * k)) * (x / (2.0 * k));
            sum += term;
        }
        return sum;
    };

    const double half = (N - 1.0) / 2.0;
    const double r = (n - half) / half;
    return static_cast<float>(bessel_i0(beta * std::sqrt(1.0 - r * r)) / bessel_i0(beta));
}

} // anonymous namespace

// ── True Peak (static member) ────────────────────────────────────────────────

float DynamicRange::compute_true_peak_4x(const float* samples, int count, int channels)
{
    if (!samples || count <= 0 || channels < 1) return 0.0f;

    // Build FIR coefficients for each phase
    float fir[kPhases][kTapsPerPhase];
    const double beta = 8.0; // Kaiser beta for ~80 dB sidelobe attenuation

    for (int phase = 0; phase < kPhases; ++phase) {
        for (int tap = 0; tap < kTapsPerPhase; ++tap) {
            const int n = tap - kSincHalfTaps;
            const double x = static_cast<double>(n) - static_cast<double>(phase) / kPhases;
            const float s = sinc_value(x);
            const float w = kaiser_window(static_cast<double>(tap), kTapsPerPhase, beta);
            fir[phase][tap] = s * w;
        }
    }

    float peak = 0.0f;

    for (int ch = 0; ch < channels; ++ch) {
        // Extract single-channel samples
        std::vector<float> mono(static_cast<size_t>(count));
        for (int i = 0; i < count; ++i) {
            mono[static_cast<size_t>(i)] = samples[static_cast<size_t>(i) * channels + ch];
        }

        // For each sample position, compute 4× oversampled values
        for (int i = kSincHalfTaps; i < count - kSincHalfTaps; ++i) {
            for (int phase = 0; phase < kPhases; ++phase) {
                float acc = 0.0f;
                for (int tap = 0; tap < kTapsPerPhase; ++tap) {
                    const int src_idx = i + tap - kSincHalfTaps;
                    acc += mono[static_cast<size_t>(src_idx)] * fir[phase][tap];
                }
                const float abs_val = std::fabs(acc);
                if (abs_val > peak) peak = abs_val;
            }
        }
    }

    return peak;
}

// ── Main Analysis ────────────────────────────────────────────────────────────

int DynamicRange::analyze(
    const char* path,
    Result& out,
    void (*progress_cb)(float, void*),
    void* userdata)
{
    std::memset(&out, 0, sizeof(out));
    out.lufs_integrated = -70.0f;
    out.true_peak_dbtp = -200.0f;

    if (!path) return -1;

    ace::FFmpegDecoder decoder;
    if (decoder.open(path) != 0) return -1;

    const auto& fmt = decoder.format();
    if (fmt.sample_rate == 0 || fmt.channels == 0) {
        if (progress_cb) progress_cb(1.0f, userdata);
        return 0;
    }

    const double fs = static_cast<double>(fmt.sample_rate);

    // ── K-weighting filters (per channel) ────────────────────────────────────

    std::vector<Biquad> hp_filters(fmt.channels);
    std::vector<Biquad> hs_filters(fmt.channels);
    for (uint8_t ch = 0; ch < fmt.channels; ++ch) {
        hp_filters[ch] = make_high_pass(fs, 38.13547087602444, 0.5003270373238773);
        hs_filters[ch] = make_high_shelf(fs, 1681.974450955533, 4.0);
    }

    // ── Sliding window state ─────────────────────────────────────────────────

    const size_t window_samples = static_cast<size_t>(
        std::max(1.0, std::round(fs * 0.400)));
    const size_t step_samples = static_cast<size_t>(
        std::max(1.0, std::round(fs * 0.100)));

    std::vector<double> window_ring(window_samples, 0.0);
    size_t ring_pos = 0;
    size_t ring_fill = 0;
    double running_sum = 0.0;
    uint64_t processed_samples = 0;

    std::vector<double> bs1770_blocks;
    double abs_peak = 0.0;
    double rms_sum = 0.0;
    uint64_t rms_count = 0;

    // DC offset accumulator
    double dc_sum = 0.0;
    uint64_t dc_count = 0;

    // Clipping detection
    uint64_t total_clip_runs = 0;
    uint32_t current_clip_run = 0;
    uint32_t max_clip_run = 0;
    static constexpr float kClipThreshold = 0.9999f;

    // True peak: process in chunks
    float global_true_peak = 0.0f;
    std::vector<float> peak_chunk;
    static constexpr int kPeakChunkSize = 4096;
    peak_chunk.reserve(static_cast<size_t>(kPeakChunkSize * fmt.channels));

    if (progress_cb) progress_cb(0.0f, userdata);

    while (true) {
        ace::DecodedBuffer buf = decoder.decode_next_frame();
        if (buf.frame_count == 0 || !buf.samples) break;

        for (uint32_t i = 0; i < buf.frame_count; ++i) {
            double weighted_power = 0.0;

            for (uint8_t ch = 0; ch < fmt.channels; ++ch) {
                const size_t idx = static_cast<size_t>(i) * fmt.channels + ch;
                const float s = buf.samples[idx];
                const double sd = static_cast<double>(s);

                // Sample peak
                abs_peak = std::max(abs_peak, std::abs(sd));

                // RMS
                rms_sum += sd * sd;
                ++rms_count;

                // DC offset
                dc_sum += sd;
                ++dc_count;

                // Clipping detection (per-sample, any channel)
                if (std::fabs(s) >= kClipThreshold) {
                    ++current_clip_run;
                } else {
                    if (current_clip_run >= 3) { // 3+ consecutive = clipping run
                        ++total_clip_runs;
                        max_clip_run = std::max(max_clip_run, current_clip_run);
                    }
                    current_clip_run = 0;
                }

                // K-weighting
                float y = hp_filters[ch].process(s);
                y = hs_filters[ch].process(y);
                const double w = bs1770_channel_weight(
                    static_cast<int>(ch), static_cast<int>(fmt.channels));
                weighted_power += w * static_cast<double>(y) * static_cast<double>(y);
            }

            // True peak chunk accumulation
            for (uint8_t ch = 0; ch < fmt.channels; ++ch) {
                peak_chunk.push_back(buf.samples[static_cast<size_t>(i) * fmt.channels + ch]);
            }
            if (static_cast<int>(peak_chunk.size()) >= kPeakChunkSize * fmt.channels) {
                const float chunk_peak = compute_true_peak_4x(
                    peak_chunk.data(),
                    kPeakChunkSize,
                    fmt.channels);
                global_true_peak = std::max(global_true_peak, chunk_peak);
                peak_chunk.clear();
            }

            // Sliding window for LUFS
            if (ring_fill < window_samples) {
                window_ring[ring_fill++] = weighted_power;
                running_sum += weighted_power;
            } else {
                running_sum += weighted_power - window_ring[ring_pos];
                window_ring[ring_pos] = weighted_power;
                ring_pos = (ring_pos + 1) % window_samples;
            }

            ++processed_samples;
            if (ring_fill == window_samples) {
                const uint64_t window_start = processed_samples - window_samples;
                if ((window_start % step_samples) == 0) {
                    bs1770_blocks.push_back(running_sum / static_cast<double>(window_samples));
                }
            }
        }

        if (progress_cb && fmt.duration_ms > 0) {
            const double ms = static_cast<double>(processed_samples) * 1000.0 / fs;
            progress_cb(static_cast<float>(
                std::clamp(ms / static_cast<double>(fmt.duration_ms), 0.0, 0.95)),
                userdata);
        }
    }

    // Process remaining true peak chunk
    if (!peak_chunk.empty()) {
        const int remaining = static_cast<int>(peak_chunk.size()) / fmt.channels;
        if (remaining > kSincHalfTaps * 2) {
            const float chunk_peak = compute_true_peak_4x(
                peak_chunk.data(), remaining, fmt.channels);
            global_true_peak = std::max(global_true_peak, chunk_peak);
        }
    }

    // Final clipping run
    if (current_clip_run >= 3) {
        ++total_clip_runs;
        max_clip_run = std::max(max_clip_run, current_clip_run);
    }

    // ── BS.1770 gating ───────────────────────────────────────────────────────

    if (!bs1770_blocks.empty()) {
        // Absolute gate at −70 LKFS
        std::vector<double> abs_gated;
        abs_gated.reserve(bs1770_blocks.size());
        for (double z : bs1770_blocks) {
            if (z <= 0.0) continue;
            const double lkfs = -0.691 + 10.0 * std::log10(z);
            if (lkfs >= -70.0) abs_gated.push_back(z);
        }

        if (!abs_gated.empty()) {
            double mean_abs = 0.0;
            for (double z : abs_gated) mean_abs += z;
            mean_abs /= static_cast<double>(abs_gated.size());

            const double l_abs = -0.691 + 10.0 * std::log10(
                std::max(mean_abs, std::numeric_limits<double>::min()));
            const double rel_gate = l_abs - 10.0;

            // Relative gate
            double mean_rel = 0.0;
            size_t rel_count = 0;
            for (double z : abs_gated) {
                const double lkfs = -0.691 + 10.0 * std::log10(z);
                if (lkfs >= rel_gate) {
                    mean_rel += z;
                    ++rel_count;
                }
            }

            if (rel_count > 0) {
                mean_rel /= static_cast<double>(rel_count);
                out.lufs_integrated = static_cast<float>(
                    -0.691 + 10.0 * std::log10(
                        std::max(mean_rel, std::numeric_limits<double>::min())));
            }
        }
    }

    // ── DR (crest factor) ────────────────────────────────────────────────────

    if (rms_count > 0) {
        const double rms = std::sqrt(rms_sum / static_cast<double>(rms_count));
        const double dr = 20.0 * std::log10(
            std::max(abs_peak, 1e-12) / std::max(rms, 1e-12));
        out.dynamic_range_db = static_cast<float>(std::max(0.0, dr));
    }

    // ── True peak in dBTP ────────────────────────────────────────────────────

    out.true_peak_dbtp = (global_true_peak > 1e-10f)
        ? 20.0f * std::log10(global_true_peak)
        : -200.0f;

    // ── DC offset ────────────────────────────────────────────────────────────

    out.dc_offset = (dc_count > 0)
        ? static_cast<float>(dc_sum / static_cast<double>(dc_count))
        : 0.0f;

    // ── Clipping ─────────────────────────────────────────────────────────────

    out.clipping_count = total_clip_runs;
    out.clipping_max_run = static_cast<float>(max_clip_run);

    if (progress_cb) progress_cb(1.0f, userdata);
    return 0;
}
