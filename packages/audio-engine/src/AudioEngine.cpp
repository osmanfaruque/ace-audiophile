#include "ace_engine.h"

#include "decoder/FFmpegDecoder.h"
#include "dsp/DspChain.h"
#include "dsp/CrossfadeEngine.h"
#include "output/AudioOutput.h"
#include "analysis/Spectrogram.h"
#include "analysis/BitDepthAnalyzer.h"
#include "analysis/LossyDetector.h"
#include "analysis/DynamicRange.h"

#include <fileref.h>
#include <tag.h>
#include <flacfile.h>
#include <flacpicture.h>
#include <xiphcomment.h>
#include <mpegfile.h>
#include <id3v2tag.h>
#include <id3v2header.h>
#include <attachedpictureframe.h>
#include <mp4file.h>
#include <mp4tag.h>
#include <mp4item.h>
#include <mp4coverart.h>

#ifdef _WIN32
#include "output/WASAPIOutput.h"
#endif

#include <atomic>
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

// ── Globals ──────────────────────────────────────────────────────────────────

static std::atomic<AceStatus>  g_status{ACE_STATUS_STOPPED};
static std::atomic<uint64_t>   g_position_ms{0};
static std::atomic<float>      g_volume{1.0f};

static AceMeterCallback   g_meter_cb   = nullptr;
static void*              g_meter_ud   = nullptr;
static AcePositionCallback g_pos_cb   = nullptr;
static void*              g_pos_ud     = nullptr;
static AceErrorCallback   g_error_cb   = nullptr;
static void*              g_error_ud   = nullptr;

static std::mutex         g_dsp_mtx;
static AceDspState        g_dsp{};

// Decoder + audio thread (A1.1.2)
static ace::FFmpegDecoder g_decoder;
static std::thread        g_audio_thread;
static std::atomic<bool>  g_thread_running{false};
static std::atomic<bool>  g_pause_flag{false};

// DSP + metering helpers
static DspChain           g_dsp_chain;
static CrossfadeEngine    g_crossfade;
static Spectrogram        g_spectrogram;

// Output backend (A1.2)
#ifdef _WIN32
static WASAPIOutput       g_output;
#endif

// ── Audio thread ─────────────────────────────────────────────────────────────

static void audio_thread_func()
{
    constexpr int kPositionIntervalMs = 100;
    uint64_t last_pos_report = 0;

    while (g_thread_running.load()) {
        if (g_pause_flag.load()) {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            continue;
        }

        ace::DecodedBuffer buf = g_decoder.decode_next_frame();

        if (buf.frame_count == 0) {
            // EOF
            g_status.store(ACE_STATUS_STOPPED);
            g_thread_running.store(false);
            break;
        }

        if (buf.track_boundary) {
            // A1.1.4 — gapless track change happened inside the decoder
            g_position_ms.store(0);
            last_pos_report = 0;
        }

        // Apply volume
        const float vol = g_volume.load();
        const int total = static_cast<int>(buf.frame_count) * g_decoder.format().channels;
        // Work on a mutable copy (pcm_buffer inside decoder is non-const via the pointer)
        float* pcm = const_cast<float*>(buf.samples);
        if (vol < 1.0f) {
            for (int i = 0; i < total; ++i)
                pcm[i] *= vol;
        }

        // DSP chain (may resample — out_frames/out_ptr may differ from input)
        int    out_frames;
        float* out_ptr;
        {
            std::lock_guard<std::mutex> lk(g_dsp_mtx);
            out_frames = g_dsp_chain.process(pcm, static_cast<int>(buf.frame_count),
                                             g_decoder.format().channels);
            out_ptr = g_dsp_chain.last_output(pcm);
        }

        // Update position (based on input frames / source sample rate)
        const auto& fmt = g_decoder.format();
        uint64_t pos = g_position_ms.load()
                     + static_cast<uint64_t>(buf.frame_count) * 1000 / fmt.sample_rate;
        g_position_ms.store(pos);

        // Position callback (~100 ms cadence)
        if (g_pos_cb && (pos - last_pos_report >= kPositionIntervalMs)) {
            g_pos_cb(pos, g_pos_ud);
            last_pos_report = pos;
        }

        // Effective output sample rate (after resampler)
        int out_sr;
        {
            std::lock_guard<std::mutex> lk(g_dsp_mtx);
            out_sr = static_cast<int>(g_dsp_chain.output_sample_rate());
        }

        // Meter callback (FFT + level) — use output data + output sample rate
        if (g_meter_cb) {
            AceFftFrame  fft{};
            AceLevelMeter lvl{};
            g_spectrogram.compute(out_ptr, out_frames, out_sr, fft);
            fft.timestamp_ms = pos;
            Spectrogram::compute_levels(out_ptr, out_frames,
                                        fmt.channels, lvl);
            g_spectrogram.store_last(fft, lvl);
            g_meter_cb(&fft, &lvl, g_meter_ud);
        } else {
            // Even without callback, keep snapshot current for ace_get_fft_frame
            AceFftFrame  fft{};
            AceLevelMeter lvl{};
            g_spectrogram.compute(out_ptr, out_frames, out_sr, fft);
            fft.timestamp_ms = pos;
            Spectrogram::compute_levels(out_ptr, out_frames,
                                        fmt.channels, lvl);
            g_spectrogram.store_last(fft, lvl);
        }

        // Write to output backend (A1.2)
#ifdef _WIN32
        g_output.write(out_ptr, out_frames);
#endif
    }
}

// ── Life-cycle ───────────────────────────────────────────────────────────────

int ace_init(void)
{
    g_status.store(ACE_STATUS_STOPPED);
    return 0;
}

void ace_shutdown(void)
{
    ace_stop();
}

// ── Device enumeration ───────────────────────────────────────────────────────

int ace_list_devices(AceDeviceInfo* out, int cap)
{
    if (cap < 1 || !out) return 0;

#ifdef _WIN32
    // A1.2.1 — real WASAPI device enumeration
    auto devices = WASAPIOutput::enumerate_devices();
    int n = 0;
    for (const auto& d : devices) {
        if (n >= cap) break;
        std::snprintf(out[n].id,   sizeof(out[n].id),   "%s", d.id.c_str());
        std::snprintf(out[n].name, sizeof(out[n].name), "%s", d.name.c_str());
        out[n].max_sample_rate    = d.max_sample_rate;
        out[n].supports_exclusive = d.supports_exclusive ? 1 : 0;
        ++n;
    }
    return n;
#else
    // Fallback for non-Windows builds
    std::snprintf(out[0].id,   sizeof(out[0].id),   "default");
    std::snprintf(out[0].name, sizeof(out[0].name),  "Default Output");
    out[0].max_sample_rate    = 48000;
    out[0].supports_exclusive = 0;
    return 1;
#endif
}

// ── Playback ─────────────────────────────────────────────────────────────────

int ace_open(const char* uri)
{
    ace_stop(); // ensure previous playback is torn down

    if (g_decoder.open(uri) != 0)
        return -1;

    // Wire up gapless track-change notification (A1.1.4)
    g_decoder.set_track_change_callback([](const ace::AudioFormat& /*fmt*/) {
        // Position resets inside the audio thread; nothing extra needed here.
    });

    // Configure DSP chain with the decoder's sample rate
    {
        std::lock_guard<std::mutex> lk(g_dsp_mtx);
        g_dsp_chain.set_sample_rate(static_cast<float>(g_decoder.format().sample_rate));
    }

    g_status.store(ACE_STATUS_STOPPED);
    g_position_ms.store(0);
    return 0;
}

int ace_open_file(const char* path)
{
    return ace_open(path);
}

int ace_play(void)
{
    if (!g_decoder.is_open()) return -1;

    if (g_pause_flag.load()) {
        // Resume from pause
        g_pause_flag.store(false);
        g_status.store(ACE_STATUS_PLAYING);
        return 0;
    }

    // Start fresh audio thread
    if (g_thread_running.load()) return 0; // already playing

#ifdef _WIN32
    // Open output device with decoder format (A1.2.2)
    const auto& fmt = g_decoder.format();
    if (g_output.open(nullptr, fmt.sample_rate, fmt.channels) != 0) {
        if (g_error_cb) g_error_cb("Failed to open WASAPI output", g_error_ud);
        return -1;
    }
#endif

    g_thread_running.store(true);
    g_pause_flag.store(false);
    g_status.store(ACE_STATUS_PLAYING);

    g_audio_thread = std::thread(audio_thread_func);
    return 0;
}

int ace_pause(void)
{
    g_pause_flag.store(true);
    g_status.store(ACE_STATUS_PAUSED);
    return 0;
}

int ace_stop(void)
{
    g_thread_running.store(false);
    g_pause_flag.store(false);

    if (g_audio_thread.joinable())
        g_audio_thread.join();

#ifdef _WIN32
    g_output.close();
#endif

    g_decoder.close();
    g_status.store(ACE_STATUS_STOPPED);
    g_position_ms.store(0);
    return 0;
}

int ace_seek(uint64_t position_ms)
{
    if (g_decoder.seek(position_ms) != 0)
        return -1;
    g_position_ms.store(position_ms);
    return 0;
}

void ace_set_volume(float vol)
{
    g_volume.store(vol > 1.0f ? 1.0f : vol < 0.0f ? 0.0f : vol);
}

uint64_t ace_get_position_ms(void) { return g_position_ms.load(); }
AceStatus ace_get_status(void)     { return g_status.load(); }

// ── Gapless queue (A1.1.4) ──────────────────────────────────────────────────

int ace_queue_next(const char* uri)
{
    return g_decoder.prepare_next(uri);
}

void ace_cancel_next(void)
{
    g_decoder.cancel_next();
}

// ── DSP ──────────────────────────────────────────────────────────────────────

int ace_set_dsp(const AceDspState* state)
{
    if (!state) return -1;
    std::lock_guard<std::mutex> lk(g_dsp_mtx);
    g_dsp = *state;
    g_dsp_chain.apply(g_dsp);
    return 0;
}

int ace_set_eq_band(int band_index, float freq_hz, float gain_db, float q,
                    uint8_t enabled, uint8_t filter_type)
{
    if (band_index < 0 || band_index >= ACE_EQ_BANDS) return -1;
    std::lock_guard<std::mutex> lk(g_dsp_mtx);
    g_dsp.bands[band_index].freq_hz     = freq_hz;
    g_dsp.bands[band_index].gain_db     = gain_db;
    g_dsp.bands[band_index].q           = q;
    g_dsp.bands[band_index].enabled     = enabled;
    g_dsp.bands[band_index].filter_type = filter_type;
    g_dsp_chain.set_eq_band(band_index, freq_hz, gain_db, q, enabled != 0, filter_type);
    return 0;
}

int ace_fit_autoeq_bands(
    const float* measured_freq_hz,
    const float* measured_spl_db,
    int measured_count,
    const float* target_freq_hz,
    const float* target_spl_db,
    int target_count,
    AceEqBand* out_bands,
    int band_count)
{
    if (!measured_freq_hz || !measured_spl_db || !target_freq_hz || !target_spl_db || !out_bands) {
        return -1;
    }
    if (measured_count < 8 || target_count < 8 || band_count <= 0) {
        return -2;
    }

    struct FrPoint {
        double freq;
        double spl;
    };

    std::vector<FrPoint> measured;
    std::vector<FrPoint> target;
    measured.reserve(static_cast<size_t>(measured_count));
    target.reserve(static_cast<size_t>(target_count));

    for (int i = 0; i < measured_count; ++i) {
        const double f = static_cast<double>(measured_freq_hz[i]);
        const double s = static_cast<double>(measured_spl_db[i]);
        if (!std::isfinite(f) || !std::isfinite(s)) continue;
        if (f < 20.0 || f > 20000.0) continue;
        measured.push_back({f, s});
    }

    for (int i = 0; i < target_count; ++i) {
        const double f = static_cast<double>(target_freq_hz[i]);
        const double s = static_cast<double>(target_spl_db[i]);
        if (!std::isfinite(f) || !std::isfinite(s)) continue;
        if (f < 20.0 || f > 20000.0) continue;
        target.push_back({f, s});
    }

    if (measured.size() < 8 || target.size() < 8) {
        return -3;
    }

    std::sort(measured.begin(), measured.end(), [](const FrPoint& a, const FrPoint& b) { return a.freq < b.freq; });
    std::sort(target.begin(), target.end(), [](const FrPoint& a, const FrPoint& b) { return a.freq < b.freq; });

    auto interp_log = [](const std::vector<FrPoint>& data, double f) {
        if (f <= data.front().freq) return data.front().spl;
        if (f >= data.back().freq) return data.back().spl;
        for (size_t i = 1; i < data.size(); ++i) {
            if (f <= data[i].freq) {
                const double f0 = data[i - 1].freq;
                const double f1 = data[i].freq;
                const double y0 = data[i - 1].spl;
                const double y1 = data[i].spl;
                const double t = (std::log10(f) - std::log10(f0)) /
                                 std::max(1e-12, std::log10(f1) - std::log10(f0));
                return y0 + (y1 - y0) * t;
            }
        }
        return data.back().spl;
    };

    const double log_min = std::log10(20.0);
    const double log_max = std::log10(20000.0);

    std::vector<double> centers(static_cast<size_t>(band_count));
    std::vector<double> gains(static_cast<size_t>(band_count), 0.0);
    std::vector<double> rhs(static_cast<size_t>(band_count), 0.0);
    std::vector<double> mat(static_cast<size_t>(band_count) * static_cast<size_t>(band_count), 0.0);

    for (int i = 0; i < band_count; ++i) {
        const double t = (band_count == 1) ? 0.0 : static_cast<double>(i) / static_cast<double>(band_count - 1);
        centers[static_cast<size_t>(i)] = std::pow(10.0, log_min + (log_max - log_min) * t);
    }

    const double basis_sigma_oct = 0.28;
    std::vector<double> basis(static_cast<size_t>(band_count));

    for (const FrPoint& m : measured) {
        const double target_spl = interp_log(target, m.freq);
        const double deviation = m.spl - target_spl; // A8.3.1

        for (int i = 0; i < band_count; ++i) {
            const double oct = std::log2(m.freq / centers[static_cast<size_t>(i)]);
            const double b = std::exp(-0.5 * (oct / basis_sigma_oct) * (oct / basis_sigma_oct));
            basis[static_cast<size_t>(i)] = b;
        }

        for (int i = 0; i < band_count; ++i) {
            const double bi = basis[static_cast<size_t>(i)];
            rhs[static_cast<size_t>(i)] += -deviation * bi;
            for (int j = 0; j < band_count; ++j) {
                mat[static_cast<size_t>(i) * static_cast<size_t>(band_count) + static_cast<size_t>(j)] +=
                    bi * basis[static_cast<size_t>(j)];
            }
        }
    }

    // Ridge regularization keeps the least-squares fit stable.
    const double lambda = 0.25;
    for (int i = 0; i < band_count; ++i) {
        mat[static_cast<size_t>(i) * static_cast<size_t>(band_count) + static_cast<size_t>(i)] += lambda;
    }

    // Gaussian elimination with partial pivoting.
    std::vector<double> aug(static_cast<size_t>(band_count) * static_cast<size_t>(band_count + 1), 0.0);
    for (int i = 0; i < band_count; ++i) {
        for (int j = 0; j < band_count; ++j) {
            aug[static_cast<size_t>(i) * static_cast<size_t>(band_count + 1) + static_cast<size_t>(j)] =
                mat[static_cast<size_t>(i) * static_cast<size_t>(band_count) + static_cast<size_t>(j)];
        }
        aug[static_cast<size_t>(i) * static_cast<size_t>(band_count + 1) + static_cast<size_t>(band_count)] = rhs[static_cast<size_t>(i)];
    }

    for (int col = 0; col < band_count; ++col) {
        int pivot = col;
        double pivot_abs = std::abs(aug[static_cast<size_t>(pivot) * static_cast<size_t>(band_count + 1) + static_cast<size_t>(col)]);
        for (int r = col + 1; r < band_count; ++r) {
            const double v = std::abs(aug[static_cast<size_t>(r) * static_cast<size_t>(band_count + 1) + static_cast<size_t>(col)]);
            if (v > pivot_abs) {
                pivot = r;
                pivot_abs = v;
            }
        }

        if (pivot_abs < 1e-12) {
            continue;
        }
        if (pivot != col) {
            for (int c = col; c <= band_count; ++c) {
                std::swap(
                    aug[static_cast<size_t>(col) * static_cast<size_t>(band_count + 1) + static_cast<size_t>(c)],
                    aug[static_cast<size_t>(pivot) * static_cast<size_t>(band_count + 1) + static_cast<size_t>(c)]
                );
            }
        }

        const double diag = aug[static_cast<size_t>(col) * static_cast<size_t>(band_count + 1) + static_cast<size_t>(col)];
        for (int c = col; c <= band_count; ++c) {
            aug[static_cast<size_t>(col) * static_cast<size_t>(band_count + 1) + static_cast<size_t>(c)] /= diag;
        }

        for (int r = 0; r < band_count; ++r) {
            if (r == col) continue;
            const double factor = aug[static_cast<size_t>(r) * static_cast<size_t>(band_count + 1) + static_cast<size_t>(col)];
            if (std::abs(factor) < 1e-16) continue;
            for (int c = col; c <= band_count; ++c) {
                aug[static_cast<size_t>(r) * static_cast<size_t>(band_count + 1) + static_cast<size_t>(c)] -=
                    factor * aug[static_cast<size_t>(col) * static_cast<size_t>(band_count + 1) + static_cast<size_t>(c)];
            }
        }
    }

    for (int i = 0; i < band_count; ++i) {
        gains[static_cast<size_t>(i)] =
            aug[static_cast<size_t>(i) * static_cast<size_t>(band_count + 1) + static_cast<size_t>(band_count)];
    }

    // A8.3.3 — clamp each gain to ±12 dB.
    for (int i = 0; i < band_count; ++i) {
        gains[static_cast<size_t>(i)] = std::clamp(gains[static_cast<size_t>(i)], -12.0, 12.0);
    }

    // A8.3.4 — smoothing pass to avoid ultra-narrow notches/peaks.
    const double oct_span = std::log2(20000.0 / 20.0);
    const double step_oct = (band_count <= 1) ? 1.0 : oct_span / static_cast<double>(band_count - 1);
    const double sigma_bands = std::max(1.0, 0.1 / std::max(1e-6, step_oct));
    const int radius = static_cast<int>(std::ceil(2.5 * sigma_bands));
    std::vector<double> smooth = gains;
    for (int i = 0; i < band_count; ++i) {
        double num = 0.0;
        double den = 0.0;
        for (int d = -radius; d <= radius; ++d) {
            const int j = i + d;
            if (j < 0 || j >= band_count) continue;
            const double w = std::exp(-0.5 * (static_cast<double>(d) / sigma_bands) *
                                      (static_cast<double>(d) / sigma_bands));
            num += gains[static_cast<size_t>(j)] * w;
            den += w;
        }
        smooth[static_cast<size_t>(i)] = (den > 0.0) ? (num / den) : gains[static_cast<size_t>(i)];
    }

    for (int i = 0; i < band_count; ++i) {
        const float f = static_cast<float>(centers[static_cast<size_t>(i)]);
        const float g = static_cast<float>(std::clamp(smooth[static_cast<size_t>(i)], -12.0, 12.0));

        out_bands[i].freq_hz = f;
        out_bands[i].gain_db = g;
        out_bands[i].q = 2.4f;
        out_bands[i].enabled = 1;
        out_bands[i].filter_type = ACE_FILTER_PEAKING;
    }

    return 0;
}

// ── Crossfeed — Bauer BS2B (A1.3.3) ─────────────────────────────────────────

void ace_set_crossfeed(uint8_t enabled, float strength)
{
    std::lock_guard<std::mutex> lk(g_dsp_mtx);
    g_dsp.crossfeed_enabled  = enabled;
    g_dsp.crossfeed_strength = strength;
    g_dsp_chain.apply(g_dsp);
}

// ── Resampler — libsoxr polyphase (A1.3.4) ──────────────────────────────────

void ace_set_resampler(uint8_t enabled, uint32_t target_hz)
{
    std::lock_guard<std::mutex> lk(g_dsp_mtx);
    g_dsp.resampler_enabled   = enabled;
    g_dsp.resampler_target_hz = target_hz;
    g_dsp_chain.apply(g_dsp);
}

// ── Dither — TPDF + noise shaping (A1.3.5) ──────────────────────────────────

void ace_set_dither(uint8_t enabled, int bits, uint8_t noise_shaping)
{
    std::lock_guard<std::mutex> lk(g_dsp_mtx);
    g_dsp.dither_enabled       = enabled;
    g_dsp.dither_bits          = bits;
    g_dsp.dither_noise_shaping = noise_shaping;
    g_dsp_chain.apply(g_dsp);
}

// ── Spatializer — virtual surround (A1.3.6) ─────────────────────────────────

void ace_set_spatializer(uint8_t enabled, float strength)
{
    std::lock_guard<std::mutex> lk(g_dsp_mtx);
    g_dsp.spatializer_enabled  = enabled;
    g_dsp.spatializer_strength = strength;
    g_dsp_chain.apply(g_dsp);
}

// ── ReplayGain — loudness normalization (A1.3.7) ─────────────────────────────

void ace_set_replay_gain(uint8_t mode, float track_gain, float album_gain,
                         float track_peak, float album_peak,
                         float pre_amp, float ceiling_db)
{
    std::lock_guard<std::mutex> lk(g_dsp_mtx);
    g_dsp.rg_mode        = mode;
    g_dsp.rg_track_gain  = track_gain;
    g_dsp.rg_album_gain  = album_gain;
    g_dsp.rg_track_peak  = track_peak;
    g_dsp.rg_album_peak  = album_peak;
    g_dsp.rg_pre_amp     = pre_amp;
    g_dsp.rg_ceiling_db  = ceiling_db;
    g_dsp_chain.apply(g_dsp);
}

// ── Limiter + anti-clip guard (A1.3.8) ───────────────────────────────────────

void ace_set_limiter(uint8_t enabled, float ceiling_db, float release_ms)
{
    std::lock_guard<std::mutex> lk(g_dsp_mtx);
    g_dsp.limiter_enabled    = enabled;
    g_dsp.limiter_ceiling_db = ceiling_db;
    g_dsp.limiter_release_ms = release_ms;
    g_dsp_chain.apply(g_dsp);
}

// ── Convolver — FIR impulse response (A1.3.9) ───────────────────────────────

int ace_load_ir(const char* path)
{
    if (!path) return -1;
    std::lock_guard<std::mutex> lk(g_dsp_mtx);
    float sr = g_dsp_chain.output_sample_rate();
    return g_dsp_chain.convolver().load_ir(path, sr);
}

void ace_unload_ir(void)
{
    std::lock_guard<std::mutex> lk(g_dsp_mtx);
    g_dsp_chain.convolver().unload();
}

// ── Channel mixer (A1.3.10) ──────────────────────────────────────────────────

void ace_set_channel_mixer(uint8_t enabled, uint8_t swap_lr, uint8_t mono,
                           float balance, uint8_t invert_l, uint8_t invert_r)
{
    std::lock_guard<std::mutex> lk(g_dsp_mtx);
    g_dsp.mixer_enabled  = enabled;
    g_dsp.mixer_swap_lr  = swap_lr;
    g_dsp.mixer_mono     = mono;
    g_dsp.mixer_balance  = balance;
    g_dsp.mixer_invert_l = invert_l;
    g_dsp.mixer_invert_r = invert_r;
    g_dsp_chain.apply(g_dsp);
}

// ── Crossfade engine (A1.3.11) ───────────────────────────────────────────────

void ace_set_crossfade(uint8_t mode, int duration_ms)
{
    std::lock_guard<std::mutex> lk(g_dsp_mtx);
    g_dsp.crossfade_mode        = mode;
    g_dsp.crossfade_duration_ms = duration_ms;
    float sr = g_dsp_chain.output_sample_rate();
    g_crossfade.configure(static_cast<CrossfadeEngine::Mode>(mode),
                          duration_ms, sr, 2);
}

// ── Pre-amp + clip detection (A1.3.2) ────────────────────────────────────────

void ace_set_preamp(float gain_db)
{
    std::lock_guard<std::mutex> lk(g_dsp_mtx);
    g_dsp.preamp_db = gain_db;
    g_dsp_chain.preamp().set_gain_db(gain_db);
}

int ace_get_preamp_clip(AceClipInfo* out)
{
    if (!out) return -1;
    const auto& pa = g_dsp_chain.preamp();
    out->peak_l       = pa.peak_l();
    out->peak_r       = pa.peak_r();
    out->clip_count_l = pa.clip_count_l();
    out->clip_count_r = pa.clip_count_r();
    out->clipped      = pa.clipped() ? 1 : 0;
    return 0;
}

void ace_reset_preamp_clip(void)
{
    g_dsp_chain.preamp().reset_stats();
}

// ── Analysis ─────────────────────────────────────────────────────────────────

static std::string json_escape(const std::string& s)
{
    std::string out;
    out.reserve(s.size() + 8);
    for (char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) out += '?';
                else out += c;
                break;
        }
    }
    return out;
}

static std::string tl_to_utf8(const TagLib::String& s)
{
    return s.to8Bit(true);
}

static std::string lowercase_ext(const std::string& path)
{
    std::filesystem::path p(path);
    std::string ext = p.has_extension() ? p.extension().string() : std::string();
    if (!ext.empty() && ext[0] == '.') ext.erase(ext.begin());
    std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return ext;
}

static std::filesystem::path art_cache_dir()
{
#ifdef _WIN32
    const char* appdata = std::getenv("APPDATA");
    if (appdata && *appdata) {
        return std::filesystem::path(appdata) / "ace" / "art";
    }
    return std::filesystem::temp_directory_path() / "ace" / "art";
#else
    const char* xdg = std::getenv("XDG_DATA_HOME");
    if (xdg && *xdg) {
        return std::filesystem::path(xdg) / "ace" / "art";
    }
    const char* home = std::getenv("HOME");
    if (home && *home) {
        return std::filesystem::path(home) / ".local" / "share" / "ace" / "art";
    }
    return std::filesystem::temp_directory_path() / "ace" / "art";
#endif
}

static std::string write_art_cache_png(const std::string& source_path, const TagLib::ByteVector& bytes)
{
    if (bytes.isEmpty()) return std::string();

    std::error_code ec;
    auto dir = art_cache_dir();
    std::filesystem::create_directories(dir, ec);
    if (ec) return std::string();

    const auto hash = std::hash<std::string>{}(source_path);
    auto out_path = dir / (std::to_string(hash) + ".png");

    std::ofstream f(out_path, std::ios::binary | std::ios::trunc);
    if (!f) return std::string();
    f.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    if (!f.good()) return std::string();
    return out_path.string();
}

int ace_extract_metadata_json(const char* path, char* out_json, int out_cap)
{
    if (!path || !out_json || out_cap <= 2) return -1;

    std::string p(path);
    std::string ext = lowercase_ext(p);

    std::string title;
    std::string artist;
    std::string album;
    std::string genre;
    std::string comment;
    int year = 0;
    int track = 0;
    int disc = 0;
    bool flac_vorbis = false;
    bool mp3_id3v24 = false;
    bool mp4_atoms = false;
    std::string art_png_path;

    // Baseline tags from generic TagLib facade.
    {
        TagLib::FileRef ref(path);
        if (!ref.isNull() && ref.tag()) {
            auto* tag = ref.tag();
            title = tl_to_utf8(tag->title());
            artist = tl_to_utf8(tag->artist());
            album = tl_to_utf8(tag->album());
            genre = tl_to_utf8(tag->genre());
            comment = tl_to_utf8(tag->comment());
            year = static_cast<int>(tag->year());
            track = static_cast<int>(tag->track());
        }
    }

    if (ext == "flac") {
        TagLib::FLAC::File flac(path);
        if (flac.isValid()) {
            auto* vc = flac.xiphComment();
            flac_vorbis = (vc != nullptr);
            if (vc) {
                const auto map = vc->fieldListMap();
                auto first = [&map](const char* k) -> std::string {
                    auto it = map.find(k);
                    if (it == map.end() || it->second.isEmpty()) return std::string();
                    return it->second.front().to8Bit(true);
                };
                if (title.empty()) title = first("TITLE");
                if (artist.empty()) artist = first("ARTIST");
                if (album.empty()) album = first("ALBUM");
                if (genre.empty()) genre = first("GENRE");
                if (comment.empty()) comment = first("COMMENT");
                if (year == 0) year = std::atoi(first("DATE").c_str());
                if (track == 0) track = std::atoi(first("TRACKNUMBER").c_str());
                if (disc == 0) disc = std::atoi(first("DISCNUMBER").c_str());
            }

            const auto pics = flac.pictureList();
            if (!pics.isEmpty()) {
                art_png_path = write_art_cache_png(p, pics.front()->data());
            }
        }
    } else if (ext == "mp3") {
        TagLib::MPEG::File mpeg(path);
        auto* id3 = mpeg.ID3v2Tag(false);
        if (id3) {
            auto* hdr = id3->header();
            if (hdr) mp3_id3v24 = (hdr->majorVersion() == 4);

            const auto apic = id3->frameListMap()["APIC"];
            if (!apic.isEmpty()) {
                auto* pic = dynamic_cast<TagLib::ID3v2::AttachedPictureFrame*>(apic.front());
                if (pic) {
                    art_png_path = write_art_cache_png(p, pic->picture());
                }
            }
        }
    } else if (ext == "m4a" || ext == "aac" || ext == "mp4") {
        TagLib::MP4::File mp4(path);
        auto* tag = mp4.tag();
        if (tag) {
            const auto items = tag->itemMap();
            mp4_atoms = !items.isEmpty();

            auto get_text = [&items](const char* key) -> std::string {
                auto it = items.find(key);
                if (it == items.end()) return std::string();
                if (!it->second.isValid()) return std::string();
                if (!it->second.toStringList().isEmpty()) return it->second.toStringList().front().to8Bit(true);
                return std::string();
            };

            if (title.empty()) title = get_text("\251nam");
            if (artist.empty()) artist = get_text("\251ART");
            if (album.empty()) album = get_text("\251alb");
            if (genre.empty()) genre = get_text("\251gen");

            auto covr_it = items.find("covr");
            if (covr_it != items.end() && covr_it->second.isValid()) {
                auto covr = covr_it->second.toCoverArtList();
                if (!covr.isEmpty()) {
                    art_png_path = write_art_cache_png(p, covr.front().data());
                }
            }
        }
    }

    std::ostringstream json;
    json << "{";
    json << "\"title\":\"" << json_escape(title) << "\",";
    json << "\"artist\":\"" << json_escape(artist) << "\",";
    json << "\"album\":\"" << json_escape(album) << "\",";
    json << "\"genre\":\"" << json_escape(genre) << "\",";
    json << "\"comment\":\"" << json_escape(comment) << "\",";
    json << "\"year\":" << year << ",";
    json << "\"track\":" << track << ",";
    json << "\"disc\":" << disc << ",";
    json << "\"album_art_path\":\"" << json_escape(art_png_path) << "\",";
    json << "\"flac_vorbis\":" << (flac_vorbis ? "true" : "false") << ",";
    json << "\"mp3_id3v24\":" << (mp3_id3v24 ? "true" : "false") << ",";
    json << "\"mp4_itunes_atoms\":" << (mp4_atoms ? "true" : "false");
    json << "}";

    const std::string out = json.str();
    if (static_cast<int>(out.size()) >= out_cap) return -2;

    std::memset(out_json, 0, static_cast<size_t>(out_cap));
    std::memcpy(out_json, out.data(), out.size());
    return 0;
}

int ace_write_metadata(const char* path, const AceTagWrite* tags)
{
    if (!path || !tags) return -1;

    const std::string p(path);
    const std::string ext = lowercase_ext(p);

    TagLib::FileRef ref(path);
    if (ref.isNull() || !ref.tag()) return -2;

    auto* tag = ref.tag();
    tag->setTitle(TagLib::String(tags->title, TagLib::String::UTF8));
    tag->setArtist(TagLib::String(tags->artist, TagLib::String::UTF8));
    tag->setAlbum(TagLib::String(tags->album, TagLib::String::UTF8));
    tag->setGenre(TagLib::String(tags->genre, TagLib::String::UTF8));
    tag->setComment(TagLib::String(tags->comment, TagLib::String::UTF8));
    tag->setYear(tags->year);
    tag->setTrack(tags->track_number);

    bool ok = false;

    if (ext == "flac") {
        TagLib::FLAC::File flac(path);
        auto* vc = flac.xiphComment(true);
        if (vc) {
            vc->addField("ALBUMARTIST", TagLib::String(tags->album_artist, TagLib::String::UTF8), true);
            vc->addField("TRACKTOTAL", TagLib::String(std::to_string(tags->track_total), TagLib::String::UTF8), true);
            vc->addField("DISCNUMBER", TagLib::String(std::to_string(tags->disc_number), TagLib::String::UTF8), true);
            vc->addField("DISCTOTAL", TagLib::String(std::to_string(tags->disc_total), TagLib::String::UTF8), true);
        }
        ok = flac.save();
    } else if (ext == "mp3") {
        TagLib::MPEG::File mpeg(path);
        auto* id3 = mpeg.ID3v2Tag(true);
        if (id3) {
            id3->setTitle(TagLib::String(tags->title, TagLib::String::UTF8));
            id3->setArtist(TagLib::String(tags->artist, TagLib::String::UTF8));
            id3->setAlbum(TagLib::String(tags->album, TagLib::String::UTF8));
            id3->setGenre(TagLib::String(tags->genre, TagLib::String::UTF8));
            id3->setComment(TagLib::String(tags->comment, TagLib::String::UTF8));
            id3->setYear(tags->year);
            id3->setTrack(tags->track_number);
        }
        ok = mpeg.save(
            TagLib::MPEG::File::ID3v2,
            TagLib::File::StripOthers,
            TagLib::ID3v2::v4,
            TagLib::File::Duplicate
        );
    } else if (ext == "m4a" || ext == "mp4" || ext == "aac") {
        TagLib::MP4::File mp4(path);
        auto* mp4_tag = mp4.tag();
        if (mp4_tag) {
            mp4_tag->setTitle(TagLib::String(tags->title, TagLib::String::UTF8));
            mp4_tag->setArtist(TagLib::String(tags->artist, TagLib::String::UTF8));
            mp4_tag->setAlbum(TagLib::String(tags->album, TagLib::String::UTF8));
            mp4_tag->setGenre(TagLib::String(tags->genre, TagLib::String::UTF8));
            mp4_tag->setComment(TagLib::String(tags->comment, TagLib::String::UTF8));
            mp4_tag->setYear(tags->year);
            mp4_tag->setTrack(tags->track_number);
            mp4_tag->setItem("aART", TagLib::MP4::Item(TagLib::StringList(TagLib::String(tags->album_artist, TagLib::String::UTF8))));
            mp4_tag->setItem("trkn", TagLib::MP4::Item(tags->track_number, tags->track_total));
            mp4_tag->setItem("disk", TagLib::MP4::Item(tags->disc_number, tags->disc_total));
        }
        ok = mp4.save();
    } else {
        ok = ref.save();
    }

    return ok ? 0 : -3;
}

int ace_embed_cover_art(const char* path, const char* image_path)
{
    if (!path || !image_path) return -1;

    std::ifstream in(image_path, std::ios::binary);
    if (!in) return -2;
    std::string bytes((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    if (bytes.empty()) return -3;

    const std::string p(path);
    const std::string ext = lowercase_ext(p);

    const std::string img = lowercase_ext(image_path);
    const bool is_png = img == "png";
    const char* mime = is_png ? "image/png" : "image/jpeg";
    TagLib::ByteVector data(bytes.data(), static_cast<unsigned int>(bytes.size()));

    if (ext == "flac") {
        TagLib::FLAC::File flac(path);
        if (!flac.isValid()) return -4;

        auto* picture = new TagLib::FLAC::Picture();
        picture->setType(TagLib::FLAC::Picture::FrontCover);
        picture->setMimeType(mime);
        picture->setData(data);
        flac.addPicture(picture);
        return flac.save() ? 0 : -5;
    }

    if (ext == "mp3") {
        TagLib::MPEG::File mpeg(path);
        auto* id3 = mpeg.ID3v2Tag(true);
        if (!id3) return -6;

        auto* frame = new TagLib::ID3v2::AttachedPictureFrame();
        frame->setType(TagLib::ID3v2::AttachedPictureFrame::FrontCover);
        frame->setMimeType(mime);
        frame->setPicture(data);
        id3->addFrame(frame);

        return mpeg.save(
            TagLib::MPEG::File::ID3v2,
            TagLib::File::StripOthers,
            TagLib::ID3v2::v4,
            TagLib::File::Duplicate
        ) ? 0 : -7;
    }

    if (ext == "m4a" || ext == "mp4" || ext == "aac") {
        TagLib::MP4::File mp4(path);
        auto* mp4_tag = mp4.tag();
        if (!mp4_tag) return -8;

        TagLib::MP4::CoverArt::Format fmt = is_png
            ? TagLib::MP4::CoverArt::PNG
            : TagLib::MP4::CoverArt::JPEG;

        TagLib::MP4::CoverArtList arts;
        arts.append(TagLib::MP4::CoverArt(fmt, data));
        mp4_tag->setItem("covr", TagLib::MP4::Item(arts));

        return mp4.save() ? 0 : -9;
    }

    return -10;
}

int ace_analyze_file(
    const char*      path,
    AceFileAnalysis* out,
    void (*progress_cb)(float, void*),
    void* userdata)
{
    if (!path || !out) return -1;
    std::memset(out, 0, sizeof(*out));

    // Populate format info from decoder
    ace::FFmpegDecoder probe;
    if (probe.open(path) != 0) return -1;

    const auto& fmt = probe.format();
    std::strncpy(out->codec, fmt.codec_name, sizeof(out->codec) - 1);
    out->sample_rate         = fmt.sample_rate;
    out->bit_depth           = fmt.bit_depth;
    out->channels            = fmt.channels;
    out->duration_ms         = fmt.duration_ms;
    out->effective_bit_depth = fmt.bit_depth;
    out->lufs_integrated     = -70.0f;

    if (fmt.sample_rate == 0 || fmt.channels == 0) {
        std::strncpy(out->verdict, "unknown", sizeof(out->verdict) - 1);
        if (progress_cb) progress_cb(1.0f, userdata);
        return 0;
    }

    // ── Phase 1: DynamicRange (LUFS, DR, true peak, DC offset, clipping) ─────
    // Progress: 0.0 – 0.5
    auto dr_progress = [&](float p, void*) {
        if (progress_cb) progress_cb(p * 0.5f, userdata);
    };

    DynamicRange dr_analyzer;
    DynamicRange::Result dr_result{};
    dr_analyzer.analyze(path, dr_result, dr_progress, nullptr);

    out->lufs_integrated  = dr_result.lufs_integrated;
    out->dynamic_range_db = dr_result.dynamic_range_db;
    out->true_peak_dbtp   = dr_result.true_peak_dbtp;
    out->dc_offset        = dr_result.dc_offset;
    out->clipping_count   = dr_result.clipping_count;

    // ── Phase 2: BitDepthAnalyzer (effective depth, spectral ceiling) ─────────
    // Progress: 0.5 – 0.75
    auto bd_progress = [&](float p, void*) {
        if (progress_cb) progress_cb(0.5f + p * 0.25f, userdata);
    };

    BitDepthAnalyzer bd_analyzer;
    BitDepthAnalyzer::Result bd_result{};
    bd_analyzer.analyze(path, bd_result, bd_progress, nullptr);

    out->effective_bit_depth = bd_result.effective_bit_depth;
    out->spectral_ceiling_hz = bd_result.spectral_ceiling_hz;
    out->zero_pad_ratio      = bd_result.zero_pad_ratio;

    // ── Phase 3: LossyDetector (transcode detection) ─────────────────────────
    // Progress: 0.75 – 0.95
    auto ld_progress = [&](float p, void*) {
        if (progress_cb) progress_cb(0.75f + p * 0.2f, userdata);
    };

    LossyDetector ld_analyzer;
    LossyDetector::Result ld_result{};
    ld_analyzer.analyze(path, ld_result, ld_progress, nullptr);

    out->is_lossy_transcoded = ld_result.is_lossy_transcode ? 1 : 0;
    out->lossy_confidence    = ld_result.confidence;
    out->frequency_cutoff_hz = ld_result.cutoff_hz;

    // ── Phase 4: Automated verdict generator (A7.2.10) ───────────────────────

    // Aggregate all signals into a plain-language quality assessment
    std::string verdict;
    std::string detail;

    if (ld_result.is_lossy_transcode) {
        verdict = "lossy_transcode";
        detail = std::string("Lossy transcode detected: ") + ld_result.explanation;
    } else if (bd_result.is_fake) {
        verdict = "upsampled";
        char buf[256];
        std::snprintf(buf, sizeof(buf),
            "Fake hi-res: declared %d-bit but effective %d-bit "
            "(%.1f%% zero-padded LSBs).",
            bd_result.declared_bit_depth, bd_result.effective_bit_depth,
            bd_result.zero_pad_ratio * 100.0f);
        detail = buf;
    } else {
        verdict = "genuine";
        detail = "Genuine lossless audio. ";
    }

    // Append supplementary notes
    if (out->clipping_count > 0) {
        char buf[128];
        std::snprintf(buf, sizeof(buf),
            " Clipping detected: %llu run(s).",
            static_cast<unsigned long long>(out->clipping_count));
        detail += buf;
    }
    if (std::fabs(out->dc_offset) > 0.001f) {
        char buf[128];
        std::snprintf(buf, sizeof(buf),
            " DC offset: %.4f (may indicate recording issue).",
            out->dc_offset);
        detail += buf;
    }
    if (out->dynamic_range_db < 6.0f && out->dynamic_range_db > 0.01f) {
        detail += " Very low dynamic range — heavily compressed/limited.";
    }

    std::strncpy(out->verdict, verdict.c_str(), sizeof(out->verdict) - 1);
    std::strncpy(out->verdict_detail, detail.c_str(), sizeof(out->verdict_detail) - 1);

    if (progress_cb) progress_cb(1.0f, userdata);
    return 0;
}

int ace_compare_mastering(
    const char* path_a,
    const char* path_b,
    AceMasteringComparison* out,
    void (*progress_cb)(float, void*),
    void* userdata)
{
    if (!path_a || !path_b || !out) return -1;

    auto decode_preview = [](const char* path,
                             int target_rate,
                             int seconds,
                             std::vector<float>& mono,
                             uint32_t& source_sr) -> int {
        ace::FFmpegDecoder dec;
        if (dec.open(path) != 0) return -1;

        const auto& fmt = dec.format();
        source_sr = fmt.sample_rate;
        if (fmt.sample_rate == 0 || fmt.channels == 0) return -2;

        const size_t target_samples = static_cast<size_t>(target_rate) * static_cast<size_t>(seconds);
        mono.clear();
        mono.reserve(target_samples);

        const double ratio = static_cast<double>(fmt.sample_rate) / static_cast<double>(target_rate);
        double phase = 0.0;
        while (mono.size() < target_samples) {
            ace::DecodedBuffer buf = dec.decode_next_frame();
            if (!buf.samples || buf.frame_count == 0) break;

            for (uint32_t i = 0; i < buf.frame_count && mono.size() < target_samples; ++i) {
                double m = 0.0;
                for (uint8_t ch = 0; ch < fmt.channels; ++ch) {
                    m += buf.samples[static_cast<size_t>(i) * fmt.channels + ch];
                }
                m /= static_cast<double>(fmt.channels);
                phase += 1.0;
                if (phase >= ratio) {
                    mono.push_back(static_cast<float>(m));
                    phase -= ratio;
                }
            }
        }
        return mono.empty() ? -3 : 0;
    };

    auto best_lag = [](const std::vector<float>& a,
                       const std::vector<float>& b,
                       int max_lag_samples) -> int {
        if (a.empty() || b.empty()) return 0;

        const int n = static_cast<int>(std::min(a.size(), b.size()));
        double best = -1e30;
        int best_l = 0;

        for (int lag = -max_lag_samples; lag <= max_lag_samples; ++lag) {
            double num = 0.0;
            double da = 0.0;
            double db = 0.0;
            int used = 0;
            for (int i = 0; i < n; ++i) {
                const int j = i + lag;
                if (j < 0 || j >= n) continue;
                const double va = a[static_cast<size_t>(i)];
                const double vb = b[static_cast<size_t>(j)];
                num += va * vb;
                da += va * va;
                db += vb * vb;
                ++used;
            }
            if (used < n / 4) continue;
            const double den = std::sqrt(std::max(da, 1e-18) * std::max(db, 1e-18));
            const double corr = num / den;
            if (corr > best) {
                best = corr;
                best_l = lag;
            }
        }
        return best_l;
    };

    auto long_term_spectrum = [](const std::vector<float>& mono,
                                 int bins,
                                 std::vector<double>& out_bins) {
        const int nfft = 256;
        const int hop = 128;
        out_bins.assign(static_cast<size_t>(bins), -120.0);
        if (mono.size() < static_cast<size_t>(nfft)) return;

        std::vector<double> acc(static_cast<size_t>(bins), 0.0);
        int frames = 0;
        for (size_t base = 0; base + static_cast<size_t>(nfft) <= mono.size(); base += static_cast<size_t>(hop)) {
            for (int k = 0; k < bins; ++k) {
                const int fft_bin = 1 + (k * (nfft / 2 - 1)) / std::max(1, bins - 1);
                double re = 0.0;
                double im = 0.0;
                for (int n = 0; n < nfft; ++n) {
                    const double w = 0.5 - 0.5 * std::cos((2.0 * 3.14159265358979323846 * n) / (nfft - 1));
                    const double s = static_cast<double>(mono[base + static_cast<size_t>(n)]) * w;
                    const double ph = (2.0 * 3.14159265358979323846 * fft_bin * n) / nfft;
                    re += s * std::cos(ph);
                    im -= s * std::sin(ph);
                }
                const double mag = std::sqrt(re * re + im * im);
                acc[static_cast<size_t>(k)] += mag;
            }
            ++frames;
        }

        if (frames <= 0) return;
        for (int i = 0; i < bins; ++i) {
            const double v = acc[static_cast<size_t>(i)] / static_cast<double>(frames);
            out_bins[static_cast<size_t>(i)] = 20.0 * std::log10(std::max(v, 1e-12));
        }
    };

    AceFileAnalysis a{};
    AceFileAnalysis b{};
    if (progress_cb) progress_cb(0.0f, userdata);
    if (ace_analyze_file(path_a, &a, nullptr, nullptr) != 0) return -2;
    if (progress_cb) progress_cb(0.2f, userdata);
    if (ace_analyze_file(path_b, &b, nullptr, nullptr) != 0) return -3;
    if (progress_cb) progress_cb(0.4f, userdata);

    std::vector<float> mono_a;
    std::vector<float> mono_b;
    uint32_t sr_a = 0;
    uint32_t sr_b = 0;
    if (decode_preview(path_a, 8000, 30, mono_a, sr_a) != 0) return -4;
    if (decode_preview(path_b, 8000, 30, mono_b, sr_b) != 0) return -5;
    if (progress_cb) progress_cb(0.7f, userdata);

    const int lag = best_lag(mono_a, mono_b, 8000 * 5);
    out->time_offset_ms = static_cast<int32_t>((1000.0 * lag) / 8000.0);

    out->dr_a = a.dynamic_range_db;
    out->dr_b = b.dynamic_range_db;
    out->lufs_a = a.lufs_integrated;
    out->lufs_b = b.lufs_integrated;
    out->true_peak_a = a.true_peak_dbtp;
    out->true_peak_b = b.true_peak_dbtp;

    std::vector<double> sa;
    std::vector<double> sb;
    long_term_spectrum(mono_a, ACE_MASTERING_DELTA_BINS, sa);
    long_term_spectrum(mono_b, ACE_MASTERING_DELTA_BINS, sb);

    out->spectral_delta_count = ACE_MASTERING_DELTA_BINS;
    for (uint32_t i = 0; i < ACE_MASTERING_DELTA_BINS; ++i) {
        const double da = (i < sa.size()) ? sa[i] : -120.0;
        const double db = (i < sb.size()) ? sb[i] : -120.0;
        out->spectral_delta_db[i] = static_cast<float>(std::clamp(da - db, -60.0, 60.0));
    }

    if (progress_cb) progress_cb(1.0f, userdata);
    return 0;
}

// ── Callbacks ────────────────────────────────────────────────────────────────

void ace_set_meter_callback(AceMeterCallback cb, void* ud)
{
    g_meter_cb = cb;
    g_meter_ud = ud;
}

int ace_get_fft_frame(AceFftFrame* fft, AceLevelMeter* level)
{
    if (!fft && !level) return -1;
    AceFftFrame  f{};
    AceLevelMeter l{};
    g_spectrogram.get_last(f, l);
    if (fft)   *fft   = f;
    if (level) *level = l;
    return (f.timestamp_ms > 0) ? 0 : -1;
}

int ace_set_stft_config(const AceStftConfig* config)
{
    if (!config) return -1;
    return g_spectrogram.set_stft_config(*config);
}

int ace_set_spectrogram_channel_mode(uint8_t mode)
{
    return g_spectrogram.set_channel_mode(mode);
}

int ace_get_spectrogram_channel(uint8_t channel_index, float* out_bins,
                                int max_frames, int* out_frames, int* out_bins_per_frame)
{
    return g_spectrogram.get_channel_ring(channel_index, out_bins, max_frames, out_frames, out_bins_per_frame);
}

void ace_set_position_callback(AcePositionCallback cb, void* ud)
{
    g_pos_cb = cb;
    g_pos_ud = ud;
}

void ace_set_error_callback(AceErrorCallback cb, void* ud)
{
    g_error_cb = cb;
    g_error_ud = ud;
}

// ── Hot-plug detection (A1.2.5) ──────────────────────────────────────────────

static AceDeviceChangeCallback g_devchange_cb = nullptr;
static void*                   g_devchange_ud = nullptr;

int ace_start_device_watch(AceDeviceChangeCallback cb, void* userdata)
{
    g_devchange_cb = cb;
    g_devchange_ud = userdata;

#ifdef _WIN32
    bool ok = WASAPIOutput::start_hotplug(
        [](WASAPIOutput::DeviceEvent ev, const std::string& id) {
            if (!g_devchange_cb) return;
            AceDeviceEvent ace_ev;
            switch (ev) {
                case WASAPIOutput::DeviceEvent::Added:          ace_ev = ACE_DEVICE_ADDED; break;
                case WASAPIOutput::DeviceEvent::Removed:        ace_ev = ACE_DEVICE_REMOVED; break;
                case WASAPIOutput::DeviceEvent::DefaultChanged: ace_ev = ACE_DEVICE_DEFAULT_CHANGED; break;
                case WASAPIOutput::DeviceEvent::StateChanged:   ace_ev = ACE_DEVICE_STATE_CHANGED; break;
                default: return;
            }
            g_devchange_cb(ace_ev, id.c_str(), g_devchange_ud);
        });
    return ok ? 0 : -1;
#else
    return -1;
#endif
}

void ace_stop_device_watch(void)
{
#ifdef _WIN32
    WASAPIOutput::stop_hotplug();
#endif
    g_devchange_cb = nullptr;
    g_devchange_ud = nullptr;
}

// ── Bit-perfect verification (A1.2.6) ────────────────────────────────────────

int ace_verify_bitperfect(const char* device_id, AceBitPerfectResult* out)
{
    if (!out) return -1;

#ifdef _WIN32
    auto r = WASAPIOutput::verify_bitperfect(device_id);
    out->passed      = r.passed ? 1 : 0;
    out->sample_rate  = r.sample_rate;
    out->bit_depth    = r.bit_depth;
    out->exclusive    = r.exclusive ? 1 : 0;
    out->hash_match   = r.hash_match;
    std::strncpy(out->detail, r.detail, sizeof(out->detail) - 1);
    out->detail[sizeof(out->detail) - 1] = '\0';
    return 0;
#else
    std::snprintf(out->detail, sizeof(out->detail), "Not supported on this platform");
    return -1;
#endif
}

// ── Container Inspector (A7.2.7) ─────────────────────────────────────────────

int ace_get_container_info(const char* path, AceContainerInfo* out)
{
    if (!path || !out) return -1;
    std::memset(out, 0, sizeof(*out));

    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) return -1;

    out->file_size = static_cast<uint64_t>(file.tellg());
    file.seekg(0, std::ios::beg);

    // Read first 12 bytes for format identification
    uint8_t header[12] = {};
    file.read(reinterpret_cast<char*>(header), 12);
    if (file.gcount() < 4) return -2;

    auto read_u32_le = [](const uint8_t* p) -> uint32_t {
        return static_cast<uint32_t>(p[0])
             | (static_cast<uint32_t>(p[1]) << 8)
             | (static_cast<uint32_t>(p[2]) << 16)
             | (static_cast<uint32_t>(p[3]) << 24);
    };

    auto read_u32_be = [](const uint8_t* p) -> uint32_t {
        return (static_cast<uint32_t>(p[0]) << 24)
             | (static_cast<uint32_t>(p[1]) << 16)
             | (static_cast<uint32_t>(p[2]) << 8)
             |  static_cast<uint32_t>(p[3]);
    };

    // ── RIFF/WAVE parser ─────────────────────────────────────────────────────
    if (std::memcmp(header, "RIFF", 4) == 0 && std::memcmp(header + 8, "WAVE", 4) == 0) {
        std::strncpy(out->format, "RIFF/WAVE", sizeof(out->format) - 1);

        // Parse chunks starting at offset 12
        uint64_t pos = 12;
        while (pos + 8 <= out->file_size && out->chunk_count < ACE_MAX_CHUNKS) {
            file.seekg(static_cast<std::streamoff>(pos));
            uint8_t chunk_hdr[8];
            file.read(reinterpret_cast<char*>(chunk_hdr), 8);
            if (file.gcount() < 8) break;

            auto& chunk = out->chunks[out->chunk_count];
            std::memcpy(chunk.id, chunk_hdr, 4);
            chunk.id[4] = '\0';
            chunk.offset = pos;
            chunk.size = read_u32_le(chunk_hdr + 4);

            // Descriptions for known chunks
            if (std::memcmp(chunk.id, "fmt ", 4) == 0)
                std::strncpy(chunk.description, "Format: audio encoding parameters", sizeof(chunk.description) - 1);
            else if (std::memcmp(chunk.id, "data", 4) == 0)
                std::strncpy(chunk.description, "Data: PCM audio samples", sizeof(chunk.description) - 1);
            else if (std::memcmp(chunk.id, "LIST", 4) == 0)
                std::strncpy(chunk.description, "LIST: metadata container (INFO)", sizeof(chunk.description) - 1);
            else if (std::memcmp(chunk.id, "fact", 4) == 0)
                std::strncpy(chunk.description, "Fact: sample count for compressed formats", sizeof(chunk.description) - 1);
            else if (std::memcmp(chunk.id, "bext", 4) == 0)
                std::strncpy(chunk.description, "Broadcast extension chunk", sizeof(chunk.description) - 1);
            else
                std::strncpy(chunk.description, "Unknown chunk", sizeof(chunk.description) - 1);

            ++out->chunk_count;

            // Chunks are word-aligned (2-byte boundary)
            uint64_t data_size = chunk.size;
            if (data_size & 1) { data_size++; out->has_padding = 1; }
            pos += 8 + data_size;
        }
    }
    // ── FLAC parser ──────────────────────────────────────────────────────────
    else if (std::memcmp(header, "fLaC", 4) == 0) {
        std::strncpy(out->format, "FLAC", sizeof(out->format) - 1);

        uint64_t pos = 4;
        bool last = false;
        while (!last && pos + 4 <= out->file_size && out->chunk_count < ACE_MAX_CHUNKS) {
            file.seekg(static_cast<std::streamoff>(pos));
            uint8_t blk_hdr[4];
            file.read(reinterpret_cast<char*>(blk_hdr), 4);
            if (file.gcount() < 4) break;

            last = (blk_hdr[0] & 0x80) != 0;
            const uint8_t type = blk_hdr[0] & 0x7F;
            const uint32_t length = (static_cast<uint32_t>(blk_hdr[1]) << 16)
                                  | (static_cast<uint32_t>(blk_hdr[2]) << 8)
                                  |  static_cast<uint32_t>(blk_hdr[3]);

            auto& chunk = out->chunks[out->chunk_count];
            chunk.offset = pos;
            chunk.size = length;

            static const char* flac_types[] = {
                "STREAMINFO", "PADDING", "APPLICATION", "SEEKTABLE",
                "VORBIS_COMMENT", "CUESHEET", "PICTURE"
            };
            if (type < 7) {
                std::strncpy(chunk.id, flac_types[type], sizeof(chunk.id) - 1);
                if (type == 1) out->has_padding = 1;
            } else {
                std::snprintf(chunk.id, sizeof(chunk.id), "BLOCK_%u", type);
            }

            std::snprintf(chunk.description, sizeof(chunk.description),
                "FLAC metadata block type %u (%s), %u bytes",
                type, chunk.id, length);

            ++out->chunk_count;
            pos += 4 + length;
        }
    }
    // ── ID3v2 header detection ───────────────────────────────────────────────
    else if (std::memcmp(header, "ID3", 3) == 0) {
        std::snprintf(out->format, sizeof(out->format), "ID3v2.%u", header[3]);

        auto& chunk = out->chunks[0];
        std::strncpy(chunk.id, "ID3v2", sizeof(chunk.id) - 1);
        chunk.offset = 0;
        // Synchsafe integer size
        const uint32_t sz = (static_cast<uint32_t>(header[6] & 0x7F) << 21)
                          | (static_cast<uint32_t>(header[7] & 0x7F) << 14)
                          | (static_cast<uint32_t>(header[8] & 0x7F) << 7)
                          |  static_cast<uint32_t>(header[9] & 0x7F);
        chunk.size = sz + 10;
        std::snprintf(chunk.description, sizeof(chunk.description),
            "ID3v2.%u tag header, %u bytes", header[3], static_cast<uint32_t>(chunk.size));
        out->chunk_count = 1;
    }
    else {
        std::strncpy(out->format, "Unknown", sizeof(out->format) - 1);
    }

    std::snprintf(out->detail, sizeof(out->detail),
        "%s container, %u chunk(s), %llu bytes total%s",
        out->format, out->chunk_count,
        static_cast<unsigned long long>(out->file_size),
        out->has_padding ? ", has padding" : "");

    return 0;
}

// ── Binary Data Viewer (A7.2.8) ──────────────────────────────────────────────

int ace_read_file_hex(const char* path, uint64_t offset, uint32_t length,
                     uint8_t* out_buf, uint32_t* out_read)
{
    if (!path || !out_buf || !out_read) return -1;
    *out_read = 0;

    // Cap at 64 KB to prevent abuse
    if (length > 65536) length = 65536;

    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) return -1;

    const auto file_size = static_cast<uint64_t>(file.tellg());
    if (offset >= file_size) return 0;

    const uint32_t actual = static_cast<uint32_t>(
        std::min(static_cast<uint64_t>(length), file_size - offset));

    file.seekg(static_cast<std::streamoff>(offset));
    file.read(reinterpret_cast<char*>(out_buf), actual);
    *out_read = static_cast<uint32_t>(file.gcount());

    return 0;
}

// ── Data Alignment Validator (A7.2.9) ────────────────────────────────────────

int ace_validate_alignment(const char* path, AceAlignmentResult* out)
{
    if (!path || !out) return -1;
    std::memset(out, 0, sizeof(*out));
    out->valid = 1;

    AceContainerInfo info{};
    if (ace_get_container_info(path, &info) != 0) {
        out->valid = 0;
        out->error_count = 1;
        std::strncpy(out->issues[0], "Cannot parse container format",
                     sizeof(out->issues[0]) - 1);
        return 0;
    }

    // Check chunk boundaries for RIFF/WAVE
    if (std::strncmp(info.format, "RIFF/WAVE", 9) == 0) {
        for (uint32_t i = 0; i < info.chunk_count && out->error_count < 4; ++i) {
            const auto& c = info.chunks[i];
            // RIFF chunks must be word-aligned (2-byte boundaries)
            if (c.offset % 2 != 0) {
                std::snprintf(out->issues[out->error_count], 256,
                    "Chunk '%s' at offset %llu is not word-aligned",
                    c.id, static_cast<unsigned long long>(c.offset));
                ++out->error_count;
                out->valid = 0;
            }
            // Verify chunk doesn't overflow file
            if (c.offset + c.size + 8 > info.file_size && i < info.chunk_count - 1) {
                std::snprintf(out->issues[out->error_count], 256,
                    "Chunk '%s' size (%llu) exceeds file boundary",
                    c.id, static_cast<unsigned long long>(c.size));
                ++out->error_count;
                out->valid = 0;
            }
        }
    }

    // Check FLAC STREAMINFO presence
    if (std::strncmp(info.format, "FLAC", 4) == 0) {
        bool has_streaminfo = false;
        for (uint32_t i = 0; i < info.chunk_count; ++i) {
            if (std::strncmp(info.chunks[i].id, "STREAMINFO", 10) == 0) {
                has_streaminfo = true;
                if (info.chunks[i].size != 34 && out->error_count < 4) {
                    std::snprintf(out->issues[out->error_count], 256,
                        "STREAMINFO block has unexpected size %llu (expected 34)",
                        static_cast<unsigned long long>(info.chunks[i].size));
                    ++out->error_count;
                    out->valid = 0;
                }
            }
        }
        if (!has_streaminfo && out->error_count < 4) {
            std::strncpy(out->issues[out->error_count],
                "Missing mandatory STREAMINFO metadata block",
                sizeof(out->issues[0]) - 1);
            ++out->error_count;
            out->valid = 0;
        }
    }

    return 0;
}

// ── Analysis Report Export (A7.3.5) ──────────────────────────────────────────

int ace_export_analysis_json(const char* path, char* out_json, int out_cap)
{
    if (!path || !out_json || out_cap < 64) return -1;

    AceFileAnalysis analysis{};
    if (ace_analyze_file(path, &analysis, nullptr, nullptr) != 0) return -1;

    AceContainerInfo container{};
    ace_get_container_info(path, &container);

    AceAlignmentResult alignment{};
    ace_validate_alignment(path, &alignment);

    // Build JSON manually (no external JSON library dependency)
    std::ostringstream j;
    j << "{\n";
    j << "  \"file\": \"" << path << "\",\n";
    j << "  \"codec\": \"" << analysis.codec << "\",\n";
    j << "  \"sample_rate\": " << analysis.sample_rate << ",\n";
    j << "  \"bit_depth\": " << static_cast<int>(analysis.bit_depth) << ",\n";
    j << "  \"effective_bit_depth\": " << static_cast<int>(analysis.effective_bit_depth) << ",\n";
    j << "  \"channels\": " << static_cast<int>(analysis.channels) << ",\n";
    j << "  \"duration_ms\": " << analysis.duration_ms << ",\n";
    j << "  \"loudness\": {\n";
    j << "    \"lufs_integrated\": " << analysis.lufs_integrated << ",\n";
    j << "    \"dynamic_range_db\": " << analysis.dynamic_range_db << ",\n";
    j << "    \"true_peak_dbtp\": " << analysis.true_peak_dbtp << "\n";
    j << "  },\n";
    j << "  \"quality\": {\n";
    j << "    \"verdict\": \"" << analysis.verdict << "\",\n";
    j << "    \"is_lossy_transcoded\": " << (analysis.is_lossy_transcoded ? "true" : "false") << ",\n";
    j << "    \"lossy_confidence\": " << analysis.lossy_confidence << ",\n";
    j << "    \"frequency_cutoff_hz\": " << analysis.frequency_cutoff_hz << ",\n";
    j << "    \"spectral_ceiling_hz\": " << analysis.spectral_ceiling_hz << ",\n";
    j << "    \"zero_pad_ratio\": " << analysis.zero_pad_ratio << ",\n";
    j << "    \"dc_offset\": " << analysis.dc_offset << ",\n";
    j << "    \"clipping_count\": " << analysis.clipping_count << "\n";
    j << "  },\n";
    j << "  \"container\": {\n";
    j << "    \"format\": \"" << container.format << "\",\n";
    j << "    \"file_size\": " << container.file_size << ",\n";
    j << "    \"chunk_count\": " << container.chunk_count << ",\n";
    j << "    \"has_padding\": " << (container.has_padding ? "true" : "false") << "\n";
    j << "  },\n";
    j << "  \"alignment\": {\n";
    j << "    \"valid\": " << (alignment.valid ? "true" : "false") << ",\n";
    j << "    \"error_count\": " << alignment.error_count << "\n";
    j << "  },\n";
    j << "  \"detail\": \"" << analysis.verdict_detail << "\"\n";
    j << "}";

    const std::string json_str = j.str();
    if (static_cast<int>(json_str.size()) >= out_cap) return -2;
    std::strncpy(out_json, json_str.c_str(), static_cast<size_t>(out_cap) - 1);
    out_json[out_cap - 1] = '\0';
    return 0;
}
