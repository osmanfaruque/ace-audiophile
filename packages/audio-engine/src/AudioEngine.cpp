#include "ace_engine.h"

#include "decoder/FFmpegDecoder.h"
#include "dsp/DspChain.h"
#include "dsp/CrossfadeEngine.h"
#include "output/AudioOutput.h"
#include "analysis/Spectrogram.h"

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
    struct Biquad {
        double b0 = 1.0;
        double b1 = 0.0;
        double b2 = 0.0;
        double a1 = 0.0;
        double a2 = 0.0;
        double z1 = 0.0;
        double z2 = 0.0;

        float process(float x)
        {
            const double y = b0 * static_cast<double>(x) + z1;
            z1 = b1 * static_cast<double>(x) - a1 * y + z2;
            z2 = b2 * static_cast<double>(x) - a2 * y;
            return static_cast<float>(y);
        }
    };

    auto make_high_pass = [](double fs, double f0, double q) {
        Biquad biq;
        const double w0 = 2.0 * 3.14159265358979323846 * f0 / fs;
        const double cw = std::cos(w0);
        const double sw = std::sin(w0);
        const double alpha = sw / (2.0 * q);

        const double b0 = (1.0 + cw) / 2.0;
        const double b1 = -(1.0 + cw);
        const double b2 = (1.0 + cw) / 2.0;
        const double a0 = 1.0 + alpha;
        const double a1 = -2.0 * cw;
        const double a2 = 1.0 - alpha;

        biq.b0 = b0 / a0;
        biq.b1 = b1 / a0;
        biq.b2 = b2 / a0;
        biq.a1 = a1 / a0;
        biq.a2 = a2 / a0;
        return biq;
    };

    auto make_high_shelf = [](double fs, double f0, double gain_db) {
        Biquad biq;
        const double a = std::pow(10.0, gain_db / 40.0);
        const double w0 = 2.0 * 3.14159265358979323846 * f0 / fs;
        const double cw = std::cos(w0);
        const double sw = std::sin(w0);
        const double s = 1.0;
        const double alpha = sw / 2.0 * std::sqrt((a + 1.0 / a) * (1.0 / s - 1.0) + 2.0);
        const double beta = 2.0 * std::sqrt(a) * alpha;

        const double b0 =    a * ((a + 1.0) + (a - 1.0) * cw + beta);
        const double b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cw);
        const double b2 =    a * ((a + 1.0) + (a - 1.0) * cw - beta);
        const double a0 =         (a + 1.0) - (a - 1.0) * cw + beta;
        const double a1 =  2.0 * ((a - 1.0) - (a + 1.0) * cw);
        const double a2 =         (a + 1.0) - (a - 1.0) * cw - beta;

        biq.b0 = b0 / a0;
        biq.b1 = b1 / a0;
        biq.b2 = b2 / a0;
        biq.a1 = a1 / a0;
        biq.a2 = a2 / a0;
        return biq;
    };

    auto bs1770_weight = [](int ch, int total_channels) {
        if (total_channels >= 6 && ch == 3) {
            // Typical 5.1 order keeps LFE at index 3; BS.1770 excludes it.
            return 0.0;
        }
        return 1.0;
    };

    if (!path || !out) return -1;

    ace::FFmpegDecoder analyzer;
    if (analyzer.open(path) != 0)
        return -1;

    const auto& fmt = analyzer.format();
    std::strncpy(out->codec, fmt.codec_name, sizeof(out->codec) - 1);
    out->sample_rate         = fmt.sample_rate;
    out->bit_depth           = fmt.bit_depth;
    out->channels            = fmt.channels;
    out->duration_ms         = fmt.duration_ms;
    out->dynamic_range_db    = 0.0f;
    out->true_peak_dbtp      = 0.0f;
    out->lufs_integrated     = -23.0f;
    out->is_lossy_transcoded = 0;
    out->effective_bit_depth = fmt.bit_depth;

    if (fmt.sample_rate == 0 || fmt.channels == 0) {
        if (progress_cb) progress_cb(1.0f, userdata);
        return 0;
    }

    std::vector<Biquad> hp_filters(fmt.channels);
    std::vector<Biquad> hs_filters(fmt.channels);
    for (uint8_t ch = 0; ch < fmt.channels; ++ch) {
        hp_filters[ch] = make_high_pass(static_cast<double>(fmt.sample_rate), 38.13547087602444, 0.5003270373238773);
        hs_filters[ch] = make_high_shelf(static_cast<double>(fmt.sample_rate), 1681.974450955533, 4.0);
    }

    const size_t window_samples = static_cast<size_t>(std::max(1.0, std::round(static_cast<double>(fmt.sample_rate) * 0.400)));
    const size_t step_samples = static_cast<size_t>(std::max(1.0, std::round(static_cast<double>(fmt.sample_rate) * 0.100)));
    std::vector<double> window_ring(window_samples, 0.0);
    size_t ring_pos = 0;
    size_t ring_fill = 0;
    double running_sum = 0.0;
    uint64_t processed_samples = 0;

    std::vector<double> bs1770_blocks;
    double abs_peak = 0.0;
    double rms_sum = 0.0;
    uint64_t rms_count = 0;

    if (progress_cb) progress_cb(0.0f, userdata);

    while (true) {
        ace::DecodedBuffer buf = analyzer.decode_next_frame();
        if (buf.frame_count == 0 || !buf.samples) {
            break;
        }

        for (uint32_t i = 0; i < buf.frame_count; ++i) {
            double weighted_power = 0.0;
            for (uint8_t ch = 0; ch < fmt.channels; ++ch) {
                const size_t idx = static_cast<size_t>(i) * fmt.channels + ch;
                const float s = buf.samples[idx];
                const double sd = static_cast<double>(s);
                abs_peak = std::max(abs_peak, std::abs(sd));
                rms_sum += sd * sd;
                ++rms_count;

                float y = hp_filters[ch].process(s);
                y = hs_filters[ch].process(y);
                const double w = bs1770_weight(static_cast<int>(ch), static_cast<int>(fmt.channels));
                weighted_power += w * static_cast<double>(y) * static_cast<double>(y);
            }

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
            const double ms = static_cast<double>(processed_samples) * 1000.0 / static_cast<double>(fmt.sample_rate);
            const float p = static_cast<float>(std::clamp(ms / static_cast<double>(fmt.duration_ms), 0.0, 0.98));
            progress_cb(p, userdata);
        }
    }

    // A7.2.1 — BS.1770/EBU R128 integrated LUFS with absolute+relative gating.
    if (!bs1770_blocks.empty()) {
        std::vector<double> abs_gated;
        abs_gated.reserve(bs1770_blocks.size());
        for (double z : bs1770_blocks) {
            if (z <= 0.0) continue;
            const double lkfs = -0.691 + 10.0 * std::log10(z);
            if (lkfs >= -70.0) {
                abs_gated.push_back(z);
            }
        }

        if (!abs_gated.empty()) {
            double mean_abs = 0.0;
            for (double z : abs_gated) mean_abs += z;
            mean_abs /= static_cast<double>(abs_gated.size());

            const double l_abs = -0.691 + 10.0 * std::log10(std::max(mean_abs, std::numeric_limits<double>::min()));
            const double rel_gate = l_abs - 10.0;

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
                out->lufs_integrated = static_cast<float>(
                    -0.691 + 10.0 * std::log10(std::max(mean_rel, std::numeric_limits<double>::min())));
            }
        }
    }

    // A7.2.1 — DR proxy score from crest factor (peak / RMS) across the full file.
    if (rms_count > 0) {
        const double rms = std::sqrt(rms_sum / static_cast<double>(rms_count));
        const double dr = 20.0 * std::log10(std::max(abs_peak, 1e-12) / std::max(rms, 1e-12));
        out->dynamic_range_db = static_cast<float>(std::max(0.0, dr));
    }

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
