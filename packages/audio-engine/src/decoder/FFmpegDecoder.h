/**
 * FFmpegDecoder.h — file decoder using FFmpeg libavformat / libavcodec
 *
 * Responsible for:
 *   - Opening audio files via AVFormatContext                   (A1.1.2)
 *   - Decoding frames via AVCodecContext                        (A1.1.2)
 *   - DSD support (DSF / DFF) with DoP passthrough              (A1.1.3)
 *   - Gapless decode with pre-buffering of next track            (A1.1.4)
 *   - Delivering interleaved float32 PCM to the DSP chain
 *
 * Part of Phase A1.1 (FFmpeg Decoder).
 */

#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <string>

// Forward-declare FFmpeg types to keep this header C++-only.
struct AVFormatContext;
struct AVCodecContext;
struct AVPacket;
struct AVFrame;
struct SwrContext;

namespace ace {

// ── DSD output mode ──────────────────────────────────────────────────────────

enum class DsdMode : uint8_t {
    None = 0,   ///< Not a DSD file.
    Pcm,        ///< FFmpeg converts DSD → float32 PCM (fallback).
    Dop,        ///< DoP: raw DSD bytes packed into 24-bit PCM frames.
};

// ── Decoded audio format ─────────────────────────────────────────────────────

struct AudioFormat {
    uint32_t sample_rate;
    uint8_t  channels;
    uint8_t  bit_depth;            ///< Original bit depth from the container.
    uint64_t duration_ms;
    char     codec_name[64];

    // A1.1.3 — DSD metadata
    DsdMode  dsd_mode       = DsdMode::None;
    uint32_t dsd_rate       = 0;   ///< Native DSD sample rate (e.g. 2822400).
    uint32_t dop_pcm_rate   = 0;   ///< DoP output PCM rate (e.g. 176400).

    // A1.1.4 — Gapless metadata
    uint32_t initial_padding = 0;  ///< Encoder delay frames to skip at start.
    uint32_t trailing_padding = 0; ///< Padding frames to trim at end.
    uint64_t total_samples   = 0;  ///< Exact sample count (if known).
};

// ── Decoded buffer ───────────────────────────────────────────────────────────

struct DecodedBuffer {
    const float* samples;          ///< Interleaved float32 PCM, channel-count wide.
    uint32_t     frame_count;
    bool         track_boundary;   ///< True if this buffer crosses into the next track (A1.1.4).
};

// ── Track-change callback (A1.1.4) ──────────────────────────────────────────

using TrackChangeCallback = std::function<void(const AudioFormat& next_format)>;

// ── FFmpegDecoder ────────────────────────────────────────────────────────────

class FFmpegDecoder {
public:
    FFmpegDecoder();
    ~FFmpegDecoder();

    FFmpegDecoder(const FFmpegDecoder&)            = delete;
    FFmpegDecoder& operator=(const FFmpegDecoder&)  = delete;

    /// Open a file path (UTF-8).  Returns 0 on success.
    int open(const char* path);

    /// Close current file and free FFmpeg contexts.
    void close();

    /// Format info of the currently-open file.
    const AudioFormat& format() const;

    /// Decode the next frame of audio.
    /// Returns {nullptr, 0, false} on EOF or error.
    /// When gapless next-track is queued, returns the first buffer of the
    /// next track with track_boundary=true instead of EOF.
    DecodedBuffer decode_next_frame();

    /// Seek to a position in milliseconds.  Returns 0 on success.
    int seek(uint64_t position_ms);

    /// Whether a file is currently open and readable.
    bool is_open() const;

    // ── A1.1.3 DSD ──────────────────────────────────────────────────────

    /// Force DSD output mode.  Call before open() to request DoP.
    /// Default: DsdMode::Pcm (FFmpeg converts to float).
    void set_dsd_mode(DsdMode mode);

    // ── A1.1.4 Gapless ─────────────────────────────────────────────────

    /// Queue the next track for gapless playback.  The file is opened
    /// and pre-buffered so that when the current track reaches EOF the
    /// decoder seamlessly continues with the next track.
    /// Returns 0 on success.
    int prepare_next(const char* path);

    /// Discard the queued next track (e.g. user changed queue).
    void cancel_next();

    /// Register a callback invoked when the decoder crosses a track boundary.
    void set_track_change_callback(TrackChangeCallback cb);

private:
    struct Impl;
    std::unique_ptr<Impl> m_impl;
};

} // namespace ace
