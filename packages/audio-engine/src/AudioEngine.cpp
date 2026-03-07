#include "ace_engine.h"

#include "dsp/DspChain.h"
#include "output/AudioOutput.h"
#include "analysis/Spectrogram.h"

#include <atomic>
#include <mutex>
#include <string>

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

// ── Life-cycle ───────────────────────────────────────────────────────────────

int ace_init(void)
{
    // TODO: initialise platform output backend, DSP chain, thread pool
    g_status.store(ACE_STATUS_STOPPED);
    return 0;
}

void ace_shutdown(void)
{
    ace_stop();
    // TODO: join audio thread, free resources
}

// ── Device enumeration ───────────────────────────────────────────────────────

int ace_list_devices(AceDeviceInfo* out, int cap)
{
    // TODO: delegate to platform output backend
    if (cap < 1 || !out) return 0;
    snprintf(out[0].id,   sizeof(out[0].id),   "default");
    snprintf(out[0].name, sizeof(out[0].name),  "Default Output");
    out[0].max_sample_rate    = 192000;
    out[0].supports_exclusive = 1;
    return 1;
}

// ── Playback ─────────────────────────────────────────────────────────────────

int ace_open(const char* /*uri*/)
{
    // TODO: decode header, fill track metadata, prepare decoder
    g_status.store(ACE_STATUS_STOPPED);
    g_position_ms.store(0);
    return 0;
}

int ace_play(void)
{
    // TODO: start / resume audio thread
    g_status.store(ACE_STATUS_PLAYING);
    return 0;
}

int ace_pause(void)
{
    g_status.store(ACE_STATUS_PAUSED);
    return 0;
}

int ace_stop(void)
{
    g_status.store(ACE_STATUS_STOPPED);
    g_position_ms.store(0);
    return 0;
}

int ace_seek(uint64_t position_ms)
{
    // TODO: flush decoder + reposition
    g_position_ms.store(position_ms);
    return 0;
}

void ace_set_volume(float vol)
{
    g_volume.store(vol > 1.0f ? 1.0f : vol < 0.0f ? 0.0f : vol);
}

uint64_t ace_get_position_ms(void) { return g_position_ms.load(); }
AceStatus ace_get_status(void)     { return g_status.load(); }

// ── DSP ──────────────────────────────────────────────────────────────────────

int ace_set_dsp(const AceDspState* state)
{
    if (!state) return -1;
    std::lock_guard<std::mutex> lk(g_dsp_mtx);
    g_dsp = *state;
    // TODO: forward to DspChain running on audio thread
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
    // TODO: open decoder, run analysis passes (DR, LUFS, codec sniff...)

    if (progress_cb) progress_cb(0.0f, userdata);

    // Stub result
    snprintf(out->codec, sizeof(out->codec), "FLAC");
    out->sample_rate         = 44100;
    out->bit_depth           = 16;
    out->channels            = 2;
    out->duration_ms         = 0;
    out->dynamic_range_db    = 0.0f;
    out->true_peak_dbtp      = 0.0f;
    out->lufs_integrated     = -23.0f;
    out->is_lossy_transcoded = 0;
    out->effective_bit_depth = 16;

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
