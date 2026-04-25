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

/** Open a local file path.  Convenience alias for ace_open(). */
int  ace_open_file(const char* path);

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

typedef enum AceFilterType {
    ACE_FILTER_PEAKING    = 0,  /**< Parametric peaking EQ (default) */
    ACE_FILTER_LOW_SHELF  = 1,  /**< Low shelf */
    ACE_FILTER_HIGH_SHELF = 2,  /**< High shelf */
    ACE_FILTER_LOW_PASS   = 3,  /**< Low-pass (2nd order) */
    ACE_FILTER_HIGH_PASS  = 4,  /**< High-pass (2nd order) */
    ACE_FILTER_BAND_PASS  = 5,  /**< Band-pass (constant skirt gain) */
    ACE_FILTER_NOTCH      = 6,  /**< Notch (band reject) */
    ACE_FILTER_ALL_PASS   = 7,  /**< All-pass (phase shift only) */
} AceFilterType;

typedef struct AceEqBand {
    float freq_hz;
    float gain_db;    /**< −24 … +24 dB */
    float q;
    uint8_t enabled;
    uint8_t filter_type;  /**< AceFilterType (default 0 = peaking) */
} AceEqBand;

typedef struct AceDspState {
    uint8_t   eq_enabled;
    AceEqBand bands[ACE_EQ_BANDS];

    uint8_t  crossfeed_enabled;
    float    crossfeed_strength;  /**< 0.0 – 1.0 */

    uint8_t  dither_enabled;
    int      dither_bits;         /**< 16 | 20 | 24 | 32 */
    uint8_t  dither_noise_shaping; /**< Non-zero = 2nd-order F-weighted noise shaping */

    uint8_t  resampler_enabled;
    uint32_t resampler_target_hz;

    uint8_t  spatializer_enabled;
    float    spatializer_strength; /**< 0.0 – 1.0 */

    uint8_t  rg_mode;             /**< 0=off, 1=track, 2=album */
    float    rg_track_gain;       /**< Per-track gain in dB (from metadata) */
    float    rg_album_gain;       /**< Per-album gain in dB */
    float    rg_track_peak;       /**< Per-track true peak (linear) */
    float    rg_album_peak;       /**< Per-album true peak (linear) */
    float    rg_pre_amp;          /**< User pre-amp offset in dB */
    float    rg_ceiling_db;       /**< True-peak ceiling in dBTP (e.g. −1.0) */

    uint8_t  limiter_enabled;
    float    limiter_ceiling_db;   /**< Output ceiling in dBFS (e.g. −0.1) */
    float    limiter_release_ms;   /**< Release time in ms (50–500, default 200) */

    uint8_t  mixer_enabled;        /**< Channel mixer (A1.3.10) */
    uint8_t  mixer_swap_lr;
    uint8_t  mixer_mono;
    float    mixer_balance;        /**< −1.0 (L) … 0 … +1.0 (R) */
    uint8_t  mixer_invert_l;
    uint8_t  mixer_invert_r;

    uint8_t  crossfade_mode;       /**< 0=off, 1=crossfade, 2=gapless (A1.3.11) */
    int      crossfade_duration_ms; /**< 100–12000 ms */

    float    preamp_db;           /**< −20 … +20 */
} AceDspState;

/** Apply DSP state atomically.  Safe to call during playback. */
int ace_set_dsp(const AceDspState* state);

/** Set a single EQ band without touching the rest of the DSP state.
 *  band_index: 0 .. ACE_EQ_BANDS-1.  filter_type: AceFilterType.  Returns 0 on success. */
int ace_set_eq_band(int band_index, float freq_hz, float gain_db, float q,
                    uint8_t enabled, uint8_t filter_type);

/* ── Auto-EQ Correction Fitting (A8.3) ───────────────────────────────────── */

/**
 * Fit PEQ gains from measured and target FR curves.
 *
 * Inputs are frequency/SPL arrays in Hz and dB. Measured and target can have
 * different frequency grids; target is log-interpolated internally.
 *
 * out_bands receives fitted PEQ bands (typically 60 entries).
 * Returns 0 on success.
 */
int ace_fit_autoeq_bands(
    const float* measured_freq_hz,
    const float* measured_spl_db,
    int measured_count,
    const float* target_freq_hz,
    const float* target_spl_db,
    int target_count,
    AceEqBand* out_bands,
    int band_count
);

/* ── Crossfeed — Bauer BS2B (A1.3.3) ──────────────────────────────────────── */

/** Enable / disable crossfeed and set strength. */
void ace_set_crossfeed(uint8_t enabled, float strength);

/* ── Resampler — libsoxr polyphase (A1.3.4) ───────────────────────────────── */

/** Enable / disable the polyphase resampler.
 *  @param enabled    Non-zero to enable.
 *  @param target_hz  Desired output sample rate (e.g. 96000, 192000). */
void ace_set_resampler(uint8_t enabled, uint32_t target_hz);

/* ── Dither — TPDF + noise shaping (A1.3.5) ───────────────────────────────── */

/** Enable / disable dither and set target bit depth.
 *  @param enabled        Non-zero to enable.
 *  @param bits           Target bit depth (16, 20, 24, or 32).
 *  @param noise_shaping  Non-zero for 2nd-order F-weighted noise shaping. */
void ace_set_dither(uint8_t enabled, int bits, uint8_t noise_shaping);

/* ── Spatializer — virtual surround (A1.3.6) ──────────────────────────────── */

/** Enable / disable the virtual-surround spatializer.
 *  @param enabled   Non-zero to enable.
 *  @param strength  Effect intensity 0.0 – 1.0. */
void ace_set_spatializer(uint8_t enabled, float strength);

/* ── ReplayGain — loudness normalization (A1.3.7) ──────────────────────────── */

/** Configure ReplayGain.
 *  @param mode          0=off, 1=track, 2=album.
 *  @param track_gain    Per-track gain in dB (from file metadata).
 *  @param album_gain    Per-album gain in dB.
 *  @param track_peak    Per-track true peak (linear, typically ≤1.0).
 *  @param album_peak    Per-album true peak (linear).
 *  @param pre_amp       User pre-amp offset in dB.
 *  @param ceiling_db    True-peak ceiling in dBTP (e.g. −1.0). */
void ace_set_replay_gain(uint8_t mode, float track_gain, float album_gain,
                         float track_peak, float album_peak,
                         float pre_amp, float ceiling_db);

/* ── Limiter + anti-clip guard (A1.3.8) ────────────────────────────────────── */

/** Enable / disable the brickwall look-ahead limiter.
 *  @param enabled      Non-zero to enable (0 = hard-clamp only).
 *  @param ceiling_db   Output ceiling in dBFS (e.g. −0.1). Clamped to ≤ 0.
 *  @param release_ms   Release time in ms (50–500). */
void ace_set_limiter(uint8_t enabled, float ceiling_db, float release_ms);

/* ── Convolver — FIR impulse response (A1.3.9) ─────────────────────────────── */

/** Load an impulse response WAV file for convolution.
 *  @param path  Path to a WAV file (16/24/32-bit, mono or stereo).
 *  @return 0 on success, negative on error. */
int ace_load_ir(const char* path);

/** Unload the current impulse response. */
void ace_unload_ir(void);

/* ── Channel mixer (A1.3.10) ────────────────────────────────────────── */

/** Configure the channel mixer matrix.
 *  @param enabled   Non-zero to enable.
 *  @param swap_lr   Non-zero to swap L/R channels.
 *  @param mono      Non-zero for mono sum.
 *  @param balance   −1.0 (full left) … 0 (center) … +1.0 (full right).
 *  @param invert_l  Non-zero to invert left channel polarity.
 *  @param invert_r  Non-zero to invert right channel polarity. */
void ace_set_channel_mixer(uint8_t enabled, uint8_t swap_lr, uint8_t mono,
                           float balance, uint8_t invert_l, uint8_t invert_r);

/* ── Crossfade engine (A1.3.11) ───────────────────────────────────────── */

/** Configure crossfade.
 *  @param mode         0=off, 1=crossfade, 2=gapless.
 *  @param duration_ms  Overlap duration in ms (100–12000). */
void ace_set_crossfade(uint8_t mode, int duration_ms);

/* ── Pre-amp + clip detection (A1.3.2) ─────────────────────────────────────── */

/** Set pre-amp gain in dB (clamped to ±20 dB). */
void ace_set_preamp(float gain_db);

typedef struct AceClipInfo {
    float    peak_l;       /**< Peak sample level (linear) since last reset */
    float    peak_r;
    uint64_t clip_count_l; /**< Clipped samples (>1.0) since last reset */
    uint64_t clip_count_r;
    uint8_t  clipped;      /**< Non-zero if any clipping since last reset */
} AceClipInfo;

/** Get pre-amp clip detection stats.  Thread-safe.  Returns 0 on success. */
int ace_get_preamp_clip(AceClipInfo* out);

/** Reset clip counters and peak trackers. */
void ace_reset_preamp_clip(void);

/* ── Analysis ──────────────────────────────────────────────────────────────── */

#define ACE_FFT_BINS 2048

typedef struct AceFftFrame {
    float    bins_l[ACE_FFT_BINS];
    float    bins_r[ACE_FFT_BINS];
    uint64_t timestamp_ms;
} AceFftFrame;

typedef enum AceFftWindowType {
    ACE_FFT_WINDOW_HANN = 0,
    ACE_FFT_WINDOW_BLACKMAN = 1,
    ACE_FFT_WINDOW_KAISER = 2,
} AceFftWindowType;

typedef enum AceSpectrogramChannelMode {
    ACE_SPEC_MODE_STEREO = 0,
    ACE_SPEC_MODE_MID_SIDE = 1,
    ACE_SPEC_MODE_MERGED = 2,
} AceSpectrogramChannelMode;

typedef struct AceStftConfig {
    uint32_t fft_size;         /**< 256..2048, power of two recommended */
    float    overlap_percent;  /**< 0..95 */
    uint8_t  window_type;      /**< AceFftWindowType */
    uint8_t  multi_resolution; /**< 0=off, 1=enable dual-resolution blend */
} AceStftConfig;

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
    float    true_peak_dbtp;       /**< 4× oversampled true peak (dBTP) (A7.2.2) */
    float    lufs_integrated;
    uint8_t  is_lossy_transcoded;
    uint8_t  effective_bit_depth;  /**< fake high-res detection (A7.2.3) */
    float    dc_offset;            /**< mean of all samples (A7.2.5) */
    uint64_t clipping_count;       /**< consecutive full-scale runs (A7.2.6) */
    int      lossy_confidence;     /**< 0–100 lossy transcode confidence (A7.2.4) */
    uint32_t frequency_cutoff_hz;  /**< spectral cutoff frequency (A7.2.4.1) */
    uint32_t spectral_ceiling_hz;  /**< energy ceiling frequency (A7.2.3.2) */
    float    zero_pad_ratio;       /**< fraction of zero-padded LSBs (A7.2.3.1) */
    char     verdict[64];          /**< "genuine", "lossy_transcode", "suspect" (A7.2.10) */
    char     verdict_detail[512];  /**< plain-language quality assessment (A7.2.10) */
} AceFileAnalysis;

#define ACE_MASTERING_DELTA_BINS 128

typedef struct AceMasteringComparison {
    int32_t  time_offset_ms;  /**< Positive => file_b starts later than file_a */
    float    dr_a;
    float    dr_b;
    float    lufs_a;
    float    lufs_b;
    float    true_peak_a;
    float    true_peak_b;
    uint32_t spectral_delta_count;
    float    spectral_delta_db[ACE_MASTERING_DELTA_BINS]; /**< LTAS delta (A-B) */
} AceMasteringComparison;

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

/**
 * Compare two versions of a track for mastering differences (A7.4).
 *
 * Returns 0 on success.
 */
int ace_compare_mastering(
    const char* path_a,
    const char* path_b,
    AceMasteringComparison* out,
    void (*progress_cb)(float progress, void* userdata),
    void* userdata
);

/**
 * Extract format-specific metadata as JSON (A4.2).
 *
 * Uses TagLib inside the C++ engine and returns a UTF-8 JSON object in
 * `out_json`. The caller provides storage via `out_cap`.
 *
 * Returns 0 on success, negative on error.
 */
int ace_extract_metadata_json(const char* path, char* out_json, int out_cap);

typedef struct AceTagWrite {
    char title[256];
    char artist[256];
    char album_artist[256];
    char album[256];
    char genre[128];
    char comment[512];
    uint32_t year;
    uint32_t track_number;
    uint32_t track_total;
    uint32_t disc_number;
    uint32_t disc_total;
} AceTagWrite;

/**
 * Write metadata tags back to the file (A4.3.1).
 *
 * FLAC writes Vorbis comments, MP3 writes ID3v2.4, and MP4/M4A writes iTunes
 * atoms through TagLib.
 */
int ace_write_metadata(const char* path, const AceTagWrite* tags);

/**
 * Embed cover art image into file tags (A4.3.4).
 *
 * `image_path` points to a local JPEG/PNG file downloaded from Cover Art
 * Archive. Returns 0 on success.
 */
int ace_embed_cover_art(const char* path, const char* image_path);

/* ── Callbacks (set once before ace_play) ─────────────────────────────────── */

/** Called from the audio thread every ~16 ms with FFT + level data. */
typedef void (*AceMeterCallback)(const AceFftFrame* fft, const AceLevelMeter* level, void* userdata);
void ace_set_meter_callback(AceMeterCallback cb, void* userdata);

/** Poll the latest FFT frame + level meter snapshot.
 *  Thread-safe.  Returns 0 on success, -1 if no data yet.
 *  This is the non-callback alternative for frontends that prefer polling. */
int ace_get_fft_frame(AceFftFrame* fft, AceLevelMeter* level);

/** Configure STFT parameters for the real-time FFT engine (A7.1.1). */
int ace_set_stft_config(const AceStftConfig* config);

/** Select spectrogram channel mode (A7.1.3). */
int ace_set_spectrogram_channel_mode(uint8_t mode);

/**
 * Export spectrogram history ring-buffer for a channel (A7.1.2).
 * channel_index: 0=left/mid/mono, 1=right/side/mono
 * out_bins: frame-major array with capacity at least (max_frames * ACE_FFT_BINS)
 */
int ace_get_spectrogram_channel(uint8_t channel_index, float* out_bins,
                                int max_frames, int* out_frames, int* out_bins_per_frame);

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

/* ── Stream protocol (A6.1) ─────────────────────────────────────────────── */

#define ACE_ICY_TEXT_CAP 256
#define ACE_HLS_URI_CAP 1024
#define ACE_HLS_MAX_SEGMENTS 256

typedef struct AceIcyHeaderInfo {
    uint8_t metadata_enabled;
    uint32_t metaint;
    uint32_t bitrate_kbps;
    char name[ACE_ICY_TEXT_CAP];
    char genre[ACE_ICY_TEXT_CAP];
    char url[ACE_ICY_TEXT_CAP];
} AceIcyHeaderInfo;

typedef struct AceIcyMetadata {
    char stream_title[ACE_ICY_TEXT_CAP];
    char stream_url[ACE_ICY_TEXT_CAP];
} AceIcyMetadata;

typedef struct AceHlsSegment {
    char uri[ACE_HLS_URI_CAP];
    float duration_sec;
} AceHlsSegment;

typedef struct AceHlsPlaylist {
    uint8_t is_live;
    uint32_t target_duration;
    uint32_t segment_count;
    AceHlsSegment segments[ACE_HLS_MAX_SEGMENTS];
} AceHlsPlaylist;

/** Parse ICY response headers and extract metadata flags/fields. */
int ace_parse_icy_headers(const char* headers_blob, AceIcyHeaderInfo* out);

/** Parse one ICY metadata block (raw bytes after metaint interval). */
int ace_parse_icy_metadata_block(const uint8_t* block, uint32_t block_len, AceIcyMetadata* out);

/** Returns retry backoff delay in ms for attempt index [0..2], else -1. */
int ace_stream_reconnect_backoff_ms(uint32_t attempt_index);

/** Parse an M3U8 playlist and resolve segment URIs against base_url. */
int ace_parse_hls_m3u8(const char* m3u8_text, const char* base_url, AceHlsPlaylist* out);

/** Download and stitch HLS segments into a single byte stream file. */
int ace_download_and_stitch_hls(const AceHlsPlaylist* playlist, const char* output_path,
                                uint32_t max_segments);

/* ── Container Inspector (A7.2.7) ──────────────────────────────────────────── */

#define ACE_MAX_CHUNKS 64

typedef struct AceChunkEntry {
    char     id[16];       /**< Chunk ID (e.g. "fmt ", "data", "RIFF") */
    uint64_t offset;       /**< Byte offset from start of file */
    uint64_t size;         /**< Chunk size in bytes */
    char     description[128]; /**< Human-readable description */
} AceChunkEntry;

typedef struct AceContainerInfo {
    char     format[32];         /**< e.g. "RIFF/WAVE", "FLAC", "ID3v2.4" */
    uint32_t chunk_count;
    AceChunkEntry chunks[ACE_MAX_CHUNKS];
    uint64_t file_size;
    uint8_t  has_padding;        /**< Non-zero if chunk padding detected */
    char     detail[512];        /**< Summary text */
} AceContainerInfo;

/** Inspect container structure and return chunk layout (A7.2.7).
 *  Returns 0 on success. */
int ace_get_container_info(const char* path, AceContainerInfo* out);

/* ── Binary Data Viewer (A7.2.8) ───────────────────────────────────────────── */

/** Read raw bytes from a file for hex display.
 *  @param path       File path.
 *  @param offset     Byte offset to start reading.
 *  @param length     Number of bytes to read (max 65536).
 *  @param out_buf    Caller-allocated buffer of at least length bytes.
 *  @param out_read   Actual bytes read.
 *  @return 0 on success. */
int ace_read_file_hex(const char* path, uint64_t offset, uint32_t length,
                     uint8_t* out_buf, uint32_t* out_read);

/* ── Data Alignment Validator (A7.2.9) ─────────────────────────────────────── */

typedef struct AceAlignmentResult {
    uint8_t  valid;             /**< Non-zero if all checks pass */
    uint32_t error_count;       /**< Number of alignment issues found */
    char     issues[4][256];    /**< Up to 4 issue descriptions */
} AceAlignmentResult;

/** Validate chunk boundary/padding consistency (A7.2.9).
 *  Returns 0 on success. */
int ace_validate_alignment(const char* path, AceAlignmentResult* out);

/* ── Analysis Report Export (A7.3.5) ───────────────────────────────────────── */

/** Export a complete analysis report as JSON.
 *  @param path       Audio file to analyse.
 *  @param out_json   Caller-allocated buffer for JSON output.
 *  @param out_cap    Capacity of out_json buffer.
 *  @return 0 on success, -1 on error, -2 if buffer too small. */
int ace_export_analysis_json(const char* path, char* out_json, int out_cap);

#ifdef __cplusplus
}
#endif
