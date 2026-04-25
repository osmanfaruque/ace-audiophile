#include "BitDepthAnalyzer.h"
#include "decoder/FFmpegDecoder.h"
#include "kiss_fft.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <numeric>
#include <vector>

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Convert a float32 sample (−1.0 … +1.0) to a signed 32-bit integer
/// representation at the given bit depth.
static inline int32_t float_to_int(float s, int bit_depth)
{
    // Clamp to avoid overflow
    s = std::clamp(s, -1.0f, 1.0f);
    const double scale = static_cast<double>(1 << (bit_depth - 1)) - 1.0;
    return static_cast<int32_t>(std::round(static_cast<double>(s) * scale));
}

// ── Public ───────────────────────────────────────────────────────────────────

int BitDepthAnalyzer::analyze(
    const char* path,
    Result& out,
    void (*progress_cb)(float, void*),
    void* userdata)
{
    std::memset(&out, 0, sizeof(out));

    if (!path) return -1;

    ace::FFmpegDecoder decoder;
    if (decoder.open(path) != 0)
        return -1;

    const auto& fmt = decoder.format();
    out.declared_bit_depth = fmt.bit_depth;

    if (fmt.sample_rate == 0 || fmt.channels == 0 || fmt.bit_depth == 0) {
        out.effective_bit_depth = fmt.bit_depth;
        if (progress_cb) progress_cb(1.0f, userdata);
        return 0;
    }

    // ── Phase 1: LSB Histogram ───────────────────────────────────────────────
    //
    // For each sample, convert to integer at declared bit depth, then count
    // which of the lowest bits are ever non-zero. If the bottom N bits are
    // always zero across a statistically significant sample, the data is
    // zero-padded from (declared − N) bits.

    const int bd = static_cast<int>(fmt.bit_depth);
    const int max_test_bits = std::min(bd, 24); // analyse up to 24 LSBs

    // bit_usage[i] = number of samples where bit i was non-zero
    std::vector<uint64_t> bit_usage(static_cast<size_t>(max_test_bits), 0);
    uint64_t total_samples = 0;

    // For spectral ceiling: accumulate mono FFT magnitude spectrum
    static constexpr int kCeilingFFTSize = 2048;
    std::vector<double> spectral_acc(kCeilingFFTSize / 2, 0.0);
    int spectral_frames = 0;
    std::vector<float> mono_buf;
    mono_buf.reserve(kCeilingFFTSize);

    if (progress_cb) progress_cb(0.0f, userdata);

    while (true) {
        ace::DecodedBuffer buf = decoder.decode_next_frame();
        if (buf.frame_count == 0 || !buf.samples) break;

        for (uint32_t i = 0; i < buf.frame_count; ++i) {
            for (uint8_t ch = 0; ch < fmt.channels; ++ch) {
                const size_t idx = static_cast<size_t>(i) * fmt.channels + ch;
                const float s = buf.samples[idx];

                // LSB analysis
                const int32_t ival = float_to_int(s, bd);
                const uint32_t uval = static_cast<uint32_t>(ival >= 0 ? ival : -ival);
                for (int b = 0; b < max_test_bits; ++b) {
                    if ((uval >> b) & 1u) {
                        ++bit_usage[static_cast<size_t>(b)];
                    }
                }
                ++total_samples;
            }

            // Spectral ceiling: accumulate mono into buffer
            float mono = 0.0f;
            for (uint8_t ch = 0; ch < fmt.channels; ++ch) {
                mono += buf.samples[static_cast<size_t>(i) * fmt.channels + ch];
            }
            mono /= static_cast<float>(fmt.channels);
            mono_buf.push_back(mono);

            if (static_cast<int>(mono_buf.size()) >= kCeilingFFTSize) {
                // Run FFT on this block
                kiss_fft_cfg cfg = kiss_fft_alloc(kCeilingFFTSize, 0, nullptr, nullptr);
                if (cfg) {
                    std::vector<kiss_fft_cpx> fin(static_cast<size_t>(kCeilingFFTSize));
                    std::vector<kiss_fft_cpx> fout(static_cast<size_t>(kCeilingFFTSize));
                    for (int k = 0; k < kCeilingFFTSize; ++k) {
                        // Hann window
                        const float w = 0.5f * (1.0f - std::cos(2.0f * 3.14159265f * k / (kCeilingFFTSize - 1)));
                        fin[static_cast<size_t>(k)].r = mono_buf[static_cast<size_t>(k)] * w;
                        fin[static_cast<size_t>(k)].i = 0.0f;
                    }
                    kiss_fft(cfg, fin.data(), fout.data());
                    kiss_fft_free(cfg);

                    const float norm = 1.0f / static_cast<float>(kCeilingFFTSize);
                    for (int k = 0; k < kCeilingFFTSize / 2; ++k) {
                        const double re = fout[static_cast<size_t>(k)].r * norm;
                        const double im = fout[static_cast<size_t>(k)].i * norm;
                        spectral_acc[static_cast<size_t>(k)] += std::sqrt(re * re + im * im);
                    }
                    ++spectral_frames;
                }
                mono_buf.clear();
            }
        }

        if (progress_cb && fmt.duration_ms > 0) {
            const double ms = static_cast<double>(total_samples / fmt.channels) * 1000.0
                              / static_cast<double>(fmt.sample_rate);
            progress_cb(static_cast<float>(std::clamp(ms / static_cast<double>(fmt.duration_ms), 0.0, 0.95)),
                        userdata);
        }
    }

    // ── Compute effective bit depth from LSB histogram ────────────────────────

    if (total_samples == 0) {
        out.effective_bit_depth = fmt.bit_depth;
        if (progress_cb) progress_cb(1.0f, userdata);
        return 0;
    }

    // Build per-bit usage ratio
    for (int b = 0; b < max_test_bits; ++b) {
        out.lsb_histogram[b] = static_cast<float>(bit_usage[static_cast<size_t>(b)])
                               / static_cast<float>(total_samples);
    }

    // Find the lowest bit that has significant usage (> 0.1% of samples)
    // All bits below this are zero-padded.
    static constexpr float kUsageThreshold = 0.001f; // 0.1%
    int lowest_active_bit = 0;
    for (int b = 0; b < max_test_bits; ++b) {
        if (out.lsb_histogram[b] > kUsageThreshold) {
            lowest_active_bit = b;
            break;
        }
        // If we reach max_test_bits without finding an active bit,
        // all bits are zero — degenerate case (silence or DC)
        if (b == max_test_bits - 1) {
            lowest_active_bit = 0; // can't determine, assume full depth
        }
    }

    out.effective_bit_depth = static_cast<uint8_t>(bd - lowest_active_bit);

    // Snap to common bit depths (8, 16, 20, 24, 32)
    const int snapped = out.effective_bit_depth;
    if (snapped > 20 && snapped < 24)      out.effective_bit_depth = 20;
    else if (snapped > 16 && snapped < 20) out.effective_bit_depth = 16;
    else if (snapped > 8  && snapped < 16) out.effective_bit_depth = 8;

    out.is_fake = (out.effective_bit_depth < out.declared_bit_depth);

    // Zero-pad ratio: fraction of samples where ALL lower bits (below effective) are zero
    if (lowest_active_bit > 0) {
        uint64_t zero_padded = 0;
        // Recalculate: the ratio of samples where bits 0..(lowest_active_bit-1) are ALL zero
        // We approximate using the average bit usage of the lowest bits
        double avg_zero_ratio = 0.0;
        for (int b = 0; b < lowest_active_bit; ++b) {
            avg_zero_ratio += (1.0 - static_cast<double>(out.lsb_histogram[b]));
        }
        out.zero_pad_ratio = static_cast<float>(avg_zero_ratio / lowest_active_bit);
    } else {
        out.zero_pad_ratio = 0.0f;
    }

    // ── Phase 2: Spectral Ceiling (A7.2.3.2) ────────────────────────────────

    out.spectral_ceiling_hz = 0;
    if (spectral_frames > 0 && fmt.sample_rate > 44100) {
        // Normalise the accumulated spectrum
        for (auto& v : spectral_acc) v /= spectral_frames;

        // Find the highest frequency bin with energy significantly above noise floor
        // Noise floor is estimated from the top 10% of bins (highest frequencies)
        const int nyquist_bins = kCeilingFFTSize / 2;
        const int noise_start = nyquist_bins - nyquist_bins / 10;
        double noise_floor = 0.0;
        int noise_count = 0;
        for (int k = noise_start; k < nyquist_bins; ++k) {
            noise_floor += spectral_acc[static_cast<size_t>(k)];
            ++noise_count;
        }
        noise_floor = (noise_count > 0) ? (noise_floor / noise_count) : 1e-10;

        // Threshold: 6 dB above noise floor (energy ratio = 2×)
        const double threshold = noise_floor * 2.0;

        // Scan from high to low frequency to find the ceiling
        int ceiling_bin = nyquist_bins - 1;
        for (int k = nyquist_bins - 1; k >= 0; --k) {
            if (spectral_acc[static_cast<size_t>(k)] > threshold) {
                ceiling_bin = k;
                break;
            }
        }

        const double bin_hz = static_cast<double>(fmt.sample_rate) / kCeilingFFTSize;
        out.spectral_ceiling_hz = static_cast<uint32_t>(ceiling_bin * bin_hz);

        // If ceiling is much lower than Nyquist, it may indicate upsampling
        // (e.g., 44.1kHz content in a 96kHz container → ceiling around 22kHz)
    }

    if (progress_cb) progress_cb(1.0f, userdata);
    return 0;
}
