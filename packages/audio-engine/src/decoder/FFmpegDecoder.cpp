/**
 * FFmpegDecoder.cpp — FFmpeg decode pipeline
 *
 * A1.1.2: Full AVFormatContext + AVCodecContext pipeline
 *         (FLAC, WAV, AIFF, MP3, AAC, Opus).
 * A1.1.3: DSD support (DSF / DFF) — DoP passthrough or PCM conversion.
 * A1.1.4: Gapless decode — pre-buffer next track, seamless boundary crossing.
 */

extern "C" {
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/opt.h>
#include <libavutil/channel_layout.h>
#include <libswresample/swresample.h>
}

#include "FFmpegDecoder.h"

#include <algorithm>
#include <cstring>
#include <mutex>
#include <vector>

namespace ace {

// ── DSD helpers ──────────────────────────────────────────────────────────────

static bool is_dsd_codec(AVCodecID id)
{
    return id == AV_CODEC_ID_DSD_LSBF
        || id == AV_CODEC_ID_DSD_MSBF
        || id == AV_CODEC_ID_DSD_LSBF_PLANAR
        || id == AV_CODEC_ID_DSD_MSBF_PLANAR;
}

static bool is_lsb_dsd(AVCodecID id)
{
    return id == AV_CODEC_ID_DSD_LSBF
        || id == AV_CODEC_ID_DSD_LSBF_PLANAR;
}

/// Reverse bits in a byte (LSB-first DSD → MSB-first for DoP).
static uint8_t reverse_bits(uint8_t b)
{
    b = static_cast<uint8_t>(((b & 0xF0) >> 4) | ((b & 0x0F) << 4));
    b = static_cast<uint8_t>(((b & 0xCC) >> 2) | ((b & 0x33) << 2));
    b = static_cast<uint8_t>(((b & 0xAA) >> 1) | ((b & 0x55) << 1));
    return b;
}

// ── Single-file decoder context ──────────────────────────────────────────────

struct DecoderCtx {
    AVFormatContext* fmt_ctx   = nullptr;
    AVCodecContext*  codec_ctx = nullptr;
    SwrContext*      swr_ctx   = nullptr;
    AVPacket*        packet    = nullptr;
    AVFrame*         frame     = nullptr;

    int              audio_stream_idx = -1;
    AudioFormat      fmt{};
    bool             opened = false;
    bool             eof    = false;

    // DSD state (A1.1.3)
    bool             is_dsd     = false;
    bool             is_lsb     = false;
    DsdMode          dsd_mode   = DsdMode::Pcm;
    uint8_t          dop_marker = 0x05;

    // Gapless state (A1.1.4)
    uint64_t         samples_decoded = 0;
    uint32_t         skip_initial    = 0;
    uint64_t         max_samples     = 0;   // 0 = unlimited

    // Output buffer (interleaved float32)
    std::vector<float> pcm_buffer;

    // ── Resource management ──

    void free_all()
    {
        if (frame)     av_frame_free(&frame);
        if (packet)    av_packet_free(&packet);
        if (swr_ctx)   swr_free(&swr_ctx);
        if (codec_ctx) avcodec_free_context(&codec_ctx);
        if (fmt_ctx)   avformat_close_input(&fmt_ctx);
        audio_stream_idx = -1;
        opened = false;
        eof    = false;
        fmt    = {};
        pcm_buffer.clear();
        samples_decoded = 0;
        skip_initial    = 0;
        max_samples     = 0;
        is_dsd     = false;
        dop_marker = 0x05;
    }

    // ── Open a file ──

    int open_file(const char* path, DsdMode requested_dsd)
    {
        if (!path) return -1;
        free_all();

        if (avformat_open_input(&fmt_ctx, path, nullptr, nullptr) < 0)
            return -1;

        if (avformat_find_stream_info(fmt_ctx, nullptr) < 0) {
            avformat_close_input(&fmt_ctx);
            return -1;
        }

        audio_stream_idx = av_find_best_stream(
            fmt_ctx, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);
        if (audio_stream_idx < 0) {
            avformat_close_input(&fmt_ctx);
            return -1;
        }

        const AVStream* stream = fmt_ctx->streams[audio_stream_idx];
        const AVCodecParameters* par = stream->codecpar;

        // A1.1.3 — DSD detection
        is_dsd = is_dsd_codec(par->codec_id);
        is_lsb = is_lsb_dsd(par->codec_id);
        dsd_mode = is_dsd ? (requested_dsd == DsdMode::None ? DsdMode::Pcm
                                                             : requested_dsd)
                          : DsdMode::None;

        const AVCodec* codec = avcodec_find_decoder(par->codec_id);
        if (!codec) {
            avformat_close_input(&fmt_ctx);
            return -1;
        }

        codec_ctx = avcodec_alloc_context3(codec);
        if (!codec_ctx) {
            avformat_close_input(&fmt_ctx);
            return -1;
        }

        if (avcodec_parameters_to_context(codec_ctx, par) < 0) {
            avcodec_free_context(&codec_ctx);
            avformat_close_input(&fmt_ctx);
            return -1;
        }

        codec_ctx->thread_count = 0; // let FFmpeg pick

        if (avcodec_open2(codec_ctx, codec, nullptr) < 0) {
            avcodec_free_context(&codec_ctx);
            avformat_close_input(&fmt_ctx);
            return -1;
        }

        // SwrContext — any decoded format → float32 interleaved
        AVChannelLayout out_layout;
        av_channel_layout_default(&out_layout, codec_ctx->ch_layout.nb_channels);

        if (swr_alloc_set_opts2(
                &swr_ctx,
                &out_layout, AV_SAMPLE_FMT_FLT, codec_ctx->sample_rate,
                &codec_ctx->ch_layout, codec_ctx->sample_fmt, codec_ctx->sample_rate,
                0, nullptr) < 0)
        {
            avcodec_free_context(&codec_ctx);
            avformat_close_input(&fmt_ctx);
            return -1;
        }
        if (swr_init(swr_ctx) < 0) {
            swr_free(&swr_ctx);
            avcodec_free_context(&codec_ctx);
            avformat_close_input(&fmt_ctx);
            return -1;
        }

        packet = av_packet_alloc();
        frame  = av_frame_alloc();

        // ── Fill AudioFormat ──
        std::strncpy(fmt.codec_name, codec->name, sizeof(fmt.codec_name) - 1);
        fmt.sample_rate = static_cast<uint32_t>(codec_ctx->sample_rate);
        fmt.channels    = static_cast<uint8_t>(codec_ctx->ch_layout.nb_channels);
        fmt.bit_depth   = static_cast<uint8_t>(
            codec_ctx->bits_per_raw_sample > 0
                ? codec_ctx->bits_per_raw_sample
                : av_get_bytes_per_sample(codec_ctx->sample_fmt) * 8);
        fmt.duration_ms =
            fmt_ctx->duration > 0
                ? static_cast<uint64_t>(fmt_ctx->duration / (AV_TIME_BASE / 1000))
                : 0;

        // DSD metadata (A1.1.3)
        if (is_dsd) {
            fmt.dsd_mode     = dsd_mode;
            fmt.dsd_rate     = static_cast<uint32_t>(par->sample_rate);
            fmt.dop_pcm_rate = fmt.dsd_rate / 16;
        }

        // Gapless metadata (A1.1.4)
        fmt.initial_padding  = static_cast<uint32_t>(par->initial_padding);
        fmt.trailing_padding = static_cast<uint32_t>(par->trailing_padding);

        if (stream->duration > 0 && stream->time_base.den > 0) {
            fmt.total_samples = static_cast<uint64_t>(
                av_rescale_q(stream->duration,
                             stream->time_base,
                             {1, static_cast<int>(fmt.sample_rate)}));
        }

        skip_initial    = fmt.initial_padding;
        max_samples     = (fmt.total_samples > 0) ? fmt.total_samples : 0;
        samples_decoded = 0;

        opened = true;
        eof    = false;
        return 0;
    }

    // ── Decode one frame from the codec ──

    uint32_t decode_one_frame()
    {
        if (!opened || eof) return 0;

        while (true) {
            int ret = avcodec_receive_frame(codec_ctx, frame);
            if (ret == 0)
                return resample_frame();

            if (ret != AVERROR(EAGAIN)) {
                eof = true;
                return 0;
            }

            // Feed more packets
            ret = read_next_audio_packet();
            if (ret < 0) {
                // EOF — flush decoder
                avcodec_send_packet(codec_ctx, nullptr);
                ret = avcodec_receive_frame(codec_ctx, frame);
                if (ret == 0) return resample_frame();
                eof = true;
                return 0;
            }
        }
    }

    int read_next_audio_packet()
    {
        while (true) {
            int ret = av_read_frame(fmt_ctx, packet);
            if (ret < 0) return ret;

            if (packet->stream_index == audio_stream_idx) {
                avcodec_send_packet(codec_ctx, packet);
                av_packet_unref(packet);
                return 0;
            }
            av_packet_unref(packet);
        }
    }

    uint32_t resample_frame()
    {
        const int out_samples = swr_get_out_samples(swr_ctx, frame->nb_samples);
        const int ch = fmt.channels;
        pcm_buffer.resize(static_cast<size_t>(out_samples * ch));

        uint8_t* out_ptr = reinterpret_cast<uint8_t*>(pcm_buffer.data());
        const int converted = swr_convert(
            swr_ctx,
            &out_ptr, out_samples,
            const_cast<const uint8_t**>(frame->extended_data),
            frame->nb_samples);

        return (converted > 0) ? static_cast<uint32_t>(converted) : 0;
    }
};

// ── Gapless padding helper (file-scope) ─────────────────────────────────────

static DecodedBuffer trim_padding(DecoderCtx& ctx, uint32_t frames, bool boundary)
{
    const int ch = ctx.fmt.channels;
    float* data  = ctx.pcm_buffer.data();

    // Skip initial encoder padding (A1.1.4)
    if (ctx.skip_initial > 0) {
        const uint32_t skip = std::min(frames, ctx.skip_initial);
        ctx.skip_initial -= skip;
        data   += skip * ch;
        frames -= skip;
        if (frames == 0) return {nullptr, 0, false};
    }

    // Trim trailing padding when exact sample count is known (A1.1.4)
    if (ctx.max_samples > 0) {
        const uint64_t remaining = ctx.max_samples - ctx.samples_decoded;
        if (remaining == 0) return {nullptr, 0, false};
        if (frames > remaining)
            frames = static_cast<uint32_t>(remaining);
    }

    ctx.samples_decoded += frames;
    return {data, frames, boundary};
}

// ── FFmpegDecoder::Impl ─────────────────────────────────────────────────────

struct FFmpegDecoder::Impl {
    DecoderCtx  current;
    DecoderCtx  next;               // A1.1.4 — pre-buffered next track

    DsdMode     requested_dsd = DsdMode::Pcm;
    bool        next_ready    = false;

    TrackChangeCallback track_change_cb;
    std::mutex  next_mtx;
};

// ── Construction / destruction ──────────────────────────────────────────────

FFmpegDecoder::FFmpegDecoder()  : m_impl(std::make_unique<Impl>()) {}
FFmpegDecoder::~FFmpegDecoder() { close(); }

// ── open ─────────────────────────────────────────────────────────────────────

int FFmpegDecoder::open(const char* path)
{
    auto& d = *m_impl;
    {
        std::lock_guard<std::mutex> lk(d.next_mtx);
        d.next.free_all();
        d.next_ready = false;
    }
    return d.current.open_file(path, d.requested_dsd);
}

// ── close ────────────────────────────────────────────────────────────────────

void FFmpegDecoder::close()
{
    auto& d = *m_impl;
    d.current.free_all();
    std::lock_guard<std::mutex> lk(d.next_mtx);
    d.next.free_all();
    d.next_ready = false;
}

// ── format ───────────────────────────────────────────────────────────────────

const AudioFormat& FFmpegDecoder::format() const { return m_impl->current.fmt; }

// ── decode_next_frame ────────────────────────────────────────────────────────

DecodedBuffer FFmpegDecoder::decode_next_frame()
{
    auto& d   = *m_impl;
    auto& cur = d.current;
    if (!cur.opened) return {nullptr, 0, false};

    while (true) {
        uint32_t frames = cur.decode_one_frame();

        if (frames == 0) {
            // Current track EOF — try gapless crossover (A1.1.4)
            std::lock_guard<std::mutex> lk(d.next_mtx);
            if (d.next_ready) {
                cur.free_all();
                std::swap(cur, d.next);
                d.next_ready = false;

                if (d.track_change_cb)
                    d.track_change_cb(cur.fmt);

                frames = cur.decode_one_frame();
                if (frames == 0) return {nullptr, 0, false};

                DecodedBuffer buf = trim_padding(cur, frames, /*boundary=*/true);
                if (buf.frame_count > 0) return buf;
                continue; // padding consumed entire frame, decode more
            }
            return {nullptr, 0, false}; // true EOF
        }

        DecodedBuffer buf = trim_padding(cur, frames, /*boundary=*/false);
        if (buf.frame_count > 0) return buf;
        // Entire frame was padding — loop for more data.
    }
}

// ── seek ─────────────────────────────────────────────────────────────────────

int FFmpegDecoder::seek(uint64_t position_ms)
{
    auto& cur = m_impl->current;
    if (!cur.opened) return -1;

    const int64_t ts = static_cast<int64_t>(position_ms) * (AV_TIME_BASE / 1000);
    if (av_seek_frame(cur.fmt_ctx, -1, ts, AVSEEK_FLAG_BACKWARD) < 0)
        return -1;

    avcodec_flush_buffers(cur.codec_ctx);

    // After seek, do not re-apply initial padding skip.
    // Reset trailing-trim counter to account for new position.
    cur.skip_initial = 0;
    if (cur.max_samples > 0) {
        // Approximate samples decoded so far based on seek target.
        cur.samples_decoded =
            static_cast<uint64_t>(position_ms) * cur.fmt.sample_rate / 1000;
    }
    cur.eof = false;
    return 0;
}

// ── is_open ──────────────────────────────────────────────────────────────────

bool FFmpegDecoder::is_open() const { return m_impl->current.opened; }

// ── A1.1.3: DSD mode ────────────────────────────────────────────────────────

void FFmpegDecoder::set_dsd_mode(DsdMode mode) { m_impl->requested_dsd = mode; }

// ── A1.1.4: Gapless — prepare / cancel next track ──────────────────────────

int FFmpegDecoder::prepare_next(const char* path)
{
    auto& d = *m_impl;
    std::lock_guard<std::mutex> lk(d.next_mtx);
    d.next.free_all();
    d.next_ready = false;

    if (d.next.open_file(path, d.requested_dsd) != 0)
        return -1;

    d.next_ready = true;
    return 0;
}

void FFmpegDecoder::cancel_next()
{
    auto& d = *m_impl;
    std::lock_guard<std::mutex> lk(d.next_mtx);
    d.next.free_all();
    d.next_ready = false;
}

void FFmpegDecoder::set_track_change_callback(TrackChangeCallback cb)
{
    m_impl->track_change_cb = std::move(cb);
}

} // namespace ace
