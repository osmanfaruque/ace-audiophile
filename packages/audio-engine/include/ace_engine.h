/**
 * ace_engine.h — flat C API for Tauri Rust bridge (FFI-safe)
 *
 * All strings are UTF-8, caller-owned unless noted otherwise.
 * All functions are thread-safe after ace_init() succeeds.
 */

#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ── Life-cycle ────────────────────────────────────────────────────────────── */

/** Initialise the engine.  Returns 0 on success, negative on error. */
int ace_init(void);

/** Tear down all resources.  Safe to call from any thread. */
void ace_shutdown(void);

/* ── Device enumeration ────────────────────────────────────────────────────── */

typedef struct AceDeviceInfo {
    char     id[128];
    char     name[256];
    uint32_t max_sample_rate;
    uint8_t  supports_exclusive;  /**< WASAPI exclusive / CoreAudio hog-mode */
} AceDeviceInfo;

/** Fill *out with up to cap devices.  Returns actual count. */
int ace_list_devices(AceDeviceInfo* out, int cap);

/* ── Playback ──────────────────────────────────────────────────────────────── */

typedef enum AceStatus {
    ACE_STATUS_STOPPED  = 0,
    ACE_STATUS_PLAYING  = 1,
    ACE_STATUS_PAUSED   = 2,
    ACE_STATUS_BUFFERING= 3,
    ACE_STATUS_ERROR    = -1,
} AceStatus;

/** Open a local file or URI.  Returns 0 on success. */
int  ace_open(const char* uri);

int  ace_play(void);
int  ace_pause(void);
int  ace_stop(void);

/** Seek to position_ms.  Returns 0 on success. */
int  ace_seek(uint64_t position_ms);

/** 0.0 – 1.0 */
void ace_set_volume(float vol);

/** Current playback position in ms. */
uint64_t ace_get_position_ms(void);

AceStatus ace_get_status(void);

/* ── Gapless Queue (A1.1.4) ────────────────────────────────────────────────── */

/** Pre-open the next track for seamless gapless transition.
 *  Returns 0 on success.  Only one track can be queued at a time. */
int  ace_queue_next(const char* uri);

/** Cancel a previously queued next track. */
void ace_cancel_next(void);

/* ── DSP ───────────────────────────────────────────────────────────────────── */

#define ACE_EQ_BANDS 60

typedef struct AceEqBand {
    float freq_hz;
    float gain_db;    /**< −24 … +24 dB */
    float q;
    uint8_t enabled;
} AceEqBand;

typedef struct AceDspState {
    uint8_t   eq_enabled;
    AceEqBand bands[ACE_EQ_BANDS];

    uint8_t  crossfeed_enabled;
    float    crossfeed_strength;  /**< 0.0 – 1.0 */

    uint8_t  dither_enabled;
    int      dither_bits;         /**< 16 | 20 | 24 */

    uint8_t  resampler_enabled;
    uint32_t resampler_target_hz;

    float    preamp_db;           /**< −20 … +20 */
} AceDspState;

/** Apply DSP state atomically.  Safe to call during playback. */
int ace_set_dsp(const AceDspState* state);

/* ── Analysis ──────────────────────────────────────────────────────────────── */

#define ACE_FFT_BINS 2048

typedef struct AceFftFrame {
    float    bins_l[ACE_FFT_BINS];
    float    bins_r[ACE_FFT_BINS];
    uint64_t timestamp_ms;
} AceFftFrame;

typedef struct AceLevelMeter {
    float peak_l_db;
    float peak_r_db;
    float rms_l_db;
    float rms_r_db;
    float lufs_integrated;
} AceLevelMeter;

typedef struct AceFileAnalysis {
    char     codec[64];
    uint32_t sample_rate;
    uint8_t  bit_depth;
    uint8_t  channels;
    uint64_t duration_ms;
    float    dynamic_range_db;
    float    true_peak_dbtp;
    float    lufs_integrated;
    uint8_t  is_lossy_transcoded;
    uint8_t  effective_bit_depth;  /**< fake high-res detection */
} AceFileAnalysis;

/**
 * Analyse a file.  Blocks until complete.  Returns 0 on success.
 * progress_cb is called with 0.0 – 1.0 on the calling thread.
 */
int ace_analyze_file(
    const char*   path,
    AceFileAnalysis* out,
    void (*progress_cb)(float progress, void* userdata),
    void* userdata
);

/* ── Callbacks (set once before ace_play) ─────────────────────────────────── */

/** Called from the audio thread every ~16 ms with FFT + level data. */
typedef void (*AceMeterCallback)(const AceFftFrame* fft, const AceLevelMeter* level, void* userdata);
void ace_set_meter_callback(AceMeterCallback cb, void* userdata);

/** Called when playback position changes (~100 ms resolution). */
typedef void (*AcePositionCallback)(uint64_t position_ms, void* userdata);
void ace_set_position_callback(AcePositionCallback cb, void* userdata);

/** Called when the engine encounters an error. */
typedef void (*AceErrorCallback)(const char* message, void* userdata);
void ace_set_error_callback(AceErrorCallback cb, void* userdata);

/* ── Hot-plug detection (A1.2.5) ───────────────────────────────────────────── */

typedef enum AceDeviceEvent {
    ACE_DEVICE_ADDED           = 0,
    ACE_DEVICE_REMOVED         = 1,
    ACE_DEVICE_DEFAULT_CHANGED = 2,
    ACE_DEVICE_STATE_CHANGED   = 3,
} AceDeviceEvent;

typedef void (*AceDeviceChangeCallback)(AceDeviceEvent event, const char* device_id,
                                        void* userdata);

/** Start listening for device add/remove/default-change events.
 *  Returns 0 on success. */
int  ace_start_device_watch(AceDeviceChangeCallback cb, void* userdata);

/** Stop listening for device change events. */
void ace_stop_device_watch(void);

/* ── Bit-perfect verification (A1.2.6) ─────────────────────────────────────── */

typedef struct AceBitPerfectResult {
    uint8_t  passed;
    uint32_t sample_rate;
    int32_t  bit_depth;
    uint8_t  exclusive;
    float    hash_match;     /**< 0.0–1.0; 1.0 = perfect */
    char     detail[256];
} AceBitPerfectResult;

/** Play a known test tone through the device and verify the signal chain.
 *  device_id may be NULL for the default device.  Returns 0 on success. */
int ace_verify_bitperfect(const char* device_id, AceBitPerfectResult* out);

#ifdef __cplusplus
}
#endif
