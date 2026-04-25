#include "LossyDetector.h"
#include "decoder/FFmpegDecoder.h"
#include "kiss_fft.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

// ── Constants ────────────────────────────────────────────────────────────────

static constexpr int    kFFTSize     = 4096;
static constexpr int    kHopSize     = 2048;
static constexpr float  kPi          = 3.14159265358979323846f;
static constexpr double kFloorDb     = -120.0;

/// Known codec cutoff fingerprints (frequency, sharpness, label)
struct CutoffProfile {
    uint32_t freq_lo;       ///< Lower bound of expected cutoff (Hz)
    uint32_t freq_hi;       ///< Upper bound of expected cutoff (Hz)
    float    min_sharpness; ///< Minimum cutoff slope (dB/octave) to match
    const char* label;      ///< Human-readable source label
    int      base_confidence;
};

static constexpr CutoffProfile kProfiles[] = {
    { 15000, 16500, 40.0f, "MP3 320",  85 },
    { 14000, 15500, 50.0f, "MP3 256",  80 },
    { 13000, 14500, 55.0f, "MP3 192",  85 },
    { 10500, 12500, 60.0f, "MP3 128",  90 },
    {  8000, 10000, 70.0f, "MP3 96",   92 },
    { 17000, 19000, 35.0f, "AAC 256",  75 },
    { 15500, 17500, 40.0f, "AAC 192",  80 },
    { 14500, 16000, 45.0f, "AAC 128",  85 },
    { 18000, 20000, 30.0f, "OGG 320",  70 },
    { 16000, 18000, 35.0f, "OGG 192",  75 },
};
static constexpr int kProfileCount = sizeof(kProfiles) / sizeof(kProfiles[0]);

// ── Implementation ───────────────────────────────────────────────────────────

int LossyDetector::analyze(
    const char* path,
    Result& out,
    void (*progress_cb)(float, void*),
    void* userdata)
{
    std::memset(&out, 0, sizeof(out));

    if (!path) return -1;

    ace::FFmpegDecoder decoder;
    if (decoder.open(path) != 0) return -1;

    const auto& fmt = decoder.format();
    if (fmt.sample_rate == 0 || fmt.channels == 0) {
        std::strncpy(out.verdict, "unknown", sizeof(out.verdict) - 1);
        std::strncpy(out.explanation, "Cannot determine: invalid format", sizeof(out.explanation) - 1);
        if (progress_cb) progress_cb(1.0f, userdata);
        return 0;
    }

    // Only meaningful for files claiming to be lossless at ≥44.1 kHz
    const double nyquist = static_cast<double>(fmt.sample_rate) / 2.0;

    // ── Accumulate long-term average spectrum (LTAS) ──────────────────────────

    const int half_bins = kFFTSize / 2;
    std::vector<double> spectrum(static_cast<size_t>(half_bins), 0.0);
    int frame_count = 0;
    std::vector<float> mono_ring;
    mono_ring.reserve(static_cast<size_t>(kFFTSize));

    // Pre-compute Hann window
    std::vector<float> window(static_cast<size_t>(kFFTSize));
    for (int i = 0; i < kFFTSize; ++i) {
        window[static_cast<size_t>(i)] = 0.5f * (1.0f - std::cos(2.0f * kPi * i / (kFFTSize - 1)));
    }

    kiss_fft_cfg fft_cfg = kiss_fft_alloc(kFFTSize, 0, nullptr, nullptr);
    if (!fft_cfg) return -2;

    std::vector<kiss_fft_cpx> fft_in(static_cast<size_t>(kFFTSize));
    std::vector<kiss_fft_cpx> fft_out(static_cast<size_t>(kFFTSize));

    uint64_t total_input_samples = 0;

    if (progress_cb) progress_cb(0.0f, userdata);

    while (true) {
        ace::DecodedBuffer buf = decoder.decode_next_frame();
        if (buf.frame_count == 0 || !buf.samples) break;

        for (uint32_t i = 0; i < buf.frame_count; ++i) {
            // Downmix to mono
            float mono = 0.0f;
            for (uint8_t ch = 0; ch < fmt.channels; ++ch) {
                mono += buf.samples[static_cast<size_t>(i) * fmt.channels + ch];
            }
            mono /= static_cast<float>(fmt.channels);
            mono_ring.push_back(mono);
            ++total_input_samples;

            if (static_cast<int>(mono_ring.size()) >= kFFTSize) {
                // Apply window and run FFT
                for (int k = 0; k < kFFTSize; ++k) {
                    fft_in[static_cast<size_t>(k)].r = mono_ring[static_cast<size_t>(k)]
                                                       * window[static_cast<size_t>(k)];
                    fft_in[static_cast<size_t>(k)].i = 0.0f;
                }

                kiss_fft(fft_cfg, fft_in.data(), fft_out.data());

                const float norm = 1.0f / static_cast<float>(kFFTSize);
                for (int k = 0; k < half_bins; ++k) {
                    const double re = fft_out[static_cast<size_t>(k)].r * norm;
                    const double im = fft_out[static_cast<size_t>(k)].i * norm;
                    spectrum[static_cast<size_t>(k)] += std::sqrt(re * re + im * im);
                }
                ++frame_count;

                // Hop forward (overlap by kFFTSize - kHopSize)
                mono_ring.erase(mono_ring.begin(),
                                mono_ring.begin() + kHopSize);
            }
        }

        if (progress_cb && fmt.duration_ms > 0) {
            const double ms = static_cast<double>(total_input_samples) * 1000.0
                              / static_cast<double>(fmt.sample_rate);
            progress_cb(static_cast<float>(std::clamp(ms / static_cast<double>(fmt.duration_ms), 0.0, 0.9)),
                        userdata);
        }
    }

    kiss_fft_free(fft_cfg);

    if (frame_count == 0) {
        std::strncpy(out.verdict, "unknown", sizeof(out.verdict) - 1);
        std::strncpy(out.explanation, "Insufficient audio data for analysis", sizeof(out.explanation) - 1);
        if (progress_cb) progress_cb(1.0f, userdata);
        return 0;
    }

    // ── Convert to dB LTAS ───────────────────────────────────────────────────

    std::vector<double> spectrum_db(static_cast<size_t>(half_bins), kFloorDb);
    for (int k = 0; k < half_bins; ++k) {
        const double v = spectrum[static_cast<size_t>(k)] / frame_count;
        spectrum_db[static_cast<size_t>(k)] = (v > 1e-12) ? 20.0 * std::log10(v) : kFloorDb;
    }

    // ── Detect spectral cutoff ───────────────────────────────────────────────
    //
    // Strategy: find the frequency where energy drops sharply compared to the
    // average energy in the 2–10 kHz "music content" band. A lossy codec creates
    // a brick-wall-like cutoff with very steep slope (>40 dB/octave).

    const double bin_hz = nyquist / half_bins;

    // Reference level: average energy in 2–10 kHz
    int bin_2k  = std::max(1, static_cast<int>(2000.0 / bin_hz));
    int bin_10k = std::min(half_bins - 1, static_cast<int>(10000.0 / bin_hz));
    double ref_level = 0.0;
    int ref_count = 0;
    for (int k = bin_2k; k <= bin_10k; ++k) {
        ref_level += spectrum_db[static_cast<size_t>(k)];
        ++ref_count;
    }
    ref_level = (ref_count > 0) ? (ref_level / ref_count) : -40.0;

    // Scan from 10 kHz upward: find where energy drops > 30 dB below reference
    const double drop_threshold = ref_level - 30.0;

    int cutoff_bin = half_bins - 1;
    bool found_cutoff = false;
    for (int k = bin_10k; k < half_bins; ++k) {
        if (spectrum_db[static_cast<size_t>(k)] < drop_threshold) {
            // Verify it's not a momentary dip: check next 5 bins are also low
            bool sustained = true;
            for (int j = 1; j <= 5 && (k + j) < half_bins; ++j) {
                if (spectrum_db[static_cast<size_t>(k + j)] > drop_threshold + 6.0) {
                    sustained = false;
                    break;
                }
            }
            if (sustained) {
                cutoff_bin = k;
                found_cutoff = true;
                break;
            }
        }
    }

    out.cutoff_hz = static_cast<uint32_t>(cutoff_bin * bin_hz);

    // ── Compute cutoff sharpness (dB/octave) ────────────────────────────────
    //
    // Measure the slope across the transition region (1 octave below cutoff
    // to 0.5 octave above cutoff). Lossy codecs: >40 dB/oct. Natural rolloff: <20.

    if (found_cutoff && cutoff_bin > 4) {
        const int one_oct_below = std::max(1, cutoff_bin / 2);
        const int half_oct_above = std::min(half_bins - 1,
                                            static_cast<int>(cutoff_bin * 1.41)); // sqrt(2)

        // Average energy in the octave below cutoff
        double energy_below = 0.0;
        int cnt_below = 0;
        for (int k = one_oct_below; k < cutoff_bin; ++k) {
            energy_below += spectrum_db[static_cast<size_t>(k)];
            ++cnt_below;
        }
        energy_below = (cnt_below > 0) ? (energy_below / cnt_below) : kFloorDb;

        // Average energy in the half-octave above cutoff
        double energy_above = 0.0;
        int cnt_above = 0;
        for (int k = cutoff_bin; k <= half_oct_above && k < half_bins; ++k) {
            energy_above += spectrum_db[static_cast<size_t>(k)];
            ++cnt_above;
        }
        energy_above = (cnt_above > 0) ? (energy_above / cnt_above) : kFloorDb;

        // Slope in dB per octave
        const double oct_span = std::log2(static_cast<double>(half_oct_above)
                                         / static_cast<double>(one_oct_below));
        out.cutoff_sharpness_db = (oct_span > 0.01)
            ? static_cast<float>(std::abs(energy_below - energy_above) / oct_span)
            : 0.0f;
    }

    // ── Match against known profiles ─────────────────────────────────────────

    out.is_lossy_transcode = false;
    out.confidence = 0;
    std::strncpy(out.probable_source, "none", sizeof(out.probable_source) - 1);

    if (found_cutoff) {
        for (int p = 0; p < kProfileCount; ++p) {
            const auto& prof = kProfiles[p];
            if (out.cutoff_hz >= prof.freq_lo && out.cutoff_hz <= prof.freq_hi
                && out.cutoff_sharpness_db >= prof.min_sharpness)
            {
                out.is_lossy_transcode = true;
                // Confidence scales with sharpness match
                const float sharpness_bonus = std::min(10.0f,
                    (out.cutoff_sharpness_db - prof.min_sharpness) * 0.5f);
                out.confidence = std::min(99,
                    static_cast<int>(prof.base_confidence + sharpness_bonus));
                std::strncpy(out.probable_source, prof.label,
                             sizeof(out.probable_source) - 1);
                break; // take the first (best) match
            }
        }

        // If no profile matched but cutoff is sharp and below 19 kHz, flag as suspect
        if (!out.is_lossy_transcode
            && out.cutoff_hz < 19000
            && out.cutoff_sharpness_db > 25.0f)
        {
            std::strncpy(out.verdict, "suspect", sizeof(out.verdict) - 1);
            out.confidence = std::min(60, static_cast<int>(out.cutoff_sharpness_db));
            std::snprintf(out.explanation, sizeof(out.explanation),
                "Sharp spectral cutoff at %u Hz (%.0f dB/oct) — possible lossy transcode "
                "but does not match a known codec profile.",
                out.cutoff_hz, out.cutoff_sharpness_db);
            if (progress_cb) progress_cb(1.0f, userdata);
            return 0;
        }
    }

    // ── Build verdict ────────────────────────────────────────────────────────

    if (out.is_lossy_transcode) {
        std::strncpy(out.verdict, "lossy_transcode", sizeof(out.verdict) - 1);
        std::snprintf(out.explanation, sizeof(out.explanation),
            "Spectral cutoff at %u Hz with %.0f dB/oct slope matches %s profile. "
            "Confidence: %d%%.",
            out.cutoff_hz, out.cutoff_sharpness_db, out.probable_source, out.confidence);
    } else {
        std::strncpy(out.verdict, "genuine", sizeof(out.verdict) - 1);
        if (found_cutoff && out.cutoff_hz < static_cast<uint32_t>(nyquist * 0.9)) {
            std::snprintf(out.explanation, sizeof(out.explanation),
                "Spectral content present up to %u Hz. Gradual rolloff (%.0f dB/oct) "
                "consistent with natural high-frequency attenuation.",
                out.cutoff_hz, out.cutoff_sharpness_db);
        } else {
            std::snprintf(out.explanation, sizeof(out.explanation),
                "Full spectral content up to Nyquist (%u Hz). No lossy transcode "
                "indicators detected.",
                static_cast<uint32_t>(nyquist));
        }
    }

    if (progress_cb) progress_cb(1.0f, userdata);
    return 0;
}
