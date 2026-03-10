#include "ace_engine.h"

#include "decoder/FFmpegDecoder.h"
#include "dsp/DspChain.h"
#include "output/AudioOutput.h"
#include "analysis/Spectrogram.h"

#ifdef _WIN32
#include "output/WASAPIOutput.h"
#endif

#include <atomic>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>

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
static Spectrogram        g_spectrogram;

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

        // DSP chain
        {
            std::lock_guard<std::mutex> lk(g_dsp_mtx);
            g_dsp_chain.process(pcm, static_cast<int>(buf.frame_count),
                                g_decoder.format().channels);
        }

        // Update position
        const auto& fmt = g_decoder.format();
        uint64_t pos = g_position_ms.load()
                     + static_cast<uint64_t>(buf.frame_count) * 1000 / fmt.sample_rate;
        g_position_ms.store(pos);

        // Position callback (~100 ms cadence)
        if (g_pos_cb && (pos - last_pos_report >= kPositionIntervalMs)) {
            g_pos_cb(pos, g_pos_ud);
            last_pos_report = pos;
        }

        // Meter callback (FFT + level)
        if (g_meter_cb) {
            AceFftFrame  fft{};
            AceLevelMeter lvl{};
            g_spectrogram.compute(pcm, static_cast<int>(buf.frame_count),
                                  static_cast<int>(fmt.sample_rate), fft);
            fft.timestamp_ms = pos;
            // TODO: fill lvl from metering pass
            g_meter_cb(&fft, &lvl, g_meter_ud);
        }

        // TODO: write to output backend (A1.2)
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

    g_status.store(ACE_STATUS_STOPPED);
    g_position_ms.store(0);
    return 0;
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

// ── Analysis ─────────────────────────────────────────────────────────────────

int ace_analyze_file(
    const char*      path,
    AceFileAnalysis* out,
    void (*progress_cb)(float, void*),
    void* userdata)
{
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

    if (progress_cb) progress_cb(0.0f, userdata);
    // TODO: full analysis passes (DR, LUFS, codec sniff) — A7.2
    if (progress_cb) progress_cb(1.0f, userdata);

    return 0;
}

// ── Callbacks ────────────────────────────────────────────────────────────────

void ace_set_meter_callback(AceMeterCallback cb, void* ud)
{
    g_meter_cb = cb;
    g_meter_ud = ud;
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
