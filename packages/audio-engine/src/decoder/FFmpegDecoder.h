/**
 * FFmpegDecoder.h — file decoder using FFmpeg libavformat / libavcodec
 *
 * Responsible for:
 *   - Opening audio files via AVFormatContext
 *   - Decoding frames via AVCodecContext
 *   - Delivering interleaved float32 PCM to the DSP chain
 *
 * Part of Phase A1.1 (FFmpeg Decoder).
 */

#pragma once

#include <cstdint>
#include <memory>
#include <string>

// Forward-declare FFmpeg types to keep this header C++-only.
// The .cpp includes the real FFmpeg headers.
struct AVFormatContext;
struct AVCodecContext;
struct AVPacket;
struct AVFrame;
struct SwrContext;

namespace ace {

/// Decoded audio format reported after opening a file.
struct AudioFormat {
    uint32_t sample_rate;
    uint8_t  channels;
    uint8_t  bit_depth;     ///< Original bit depth from the container.
    uint64_t duration_ms;
    char     codec_name[64];
};

/// Read-result from decode_next_frame().
struct DecodedBuffer {
    const float* samples;   ///< Interleaved float32 PCM, channel-count wide.
    uint32_t     frame_count;
};

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
    /// Returns {nullptr, 0} on EOF or error.
    DecodedBuffer decode_next_frame();

    /// Seek to a position in milliseconds.  Returns 0 on success.
    int seek(uint64_t position_ms);

    /// Whether a file is currently open and readable.
    bool is_open() const;

private:
    struct Impl;
    std::unique_ptr<Impl> m_impl;
};

} // namespace ace
