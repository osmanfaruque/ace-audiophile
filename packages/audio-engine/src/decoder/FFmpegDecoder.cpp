/**
 * FFmpegDecoder.cpp — FFmpeg decode pipeline (A1.1.1 + skeleton for A1.1.2)
 *
 * A1.1.1 scope: verify FFmpeg headers are found and the file compiles.
 * A1.1.2 scope: full AVFormatContext + AVCodecContext pipeline (TODO).
 */

// FFmpeg headers are pure C — include inside extern "C" block.
extern "C" {
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/opt.h>
#include <libavutil/channel_layout.h>
#include <libswresample/swresample.h>
}

#include "FFmpegDecoder.h"

#include <cstring>
#include <vector>

namespace ace {

// ── Private implementation ───────────────────────────────────────────────────

struct FFmpegDecoder::Impl {
    AVFormatContext* fmt_ctx   = nullptr;
    AVCodecContext*  codec_ctx = nullptr;
    SwrContext*      swr_ctx   = nullptr;
    AVPacket*        packet    = nullptr;
    AVFrame*         frame     = nullptr;

    int              audio_stream_idx = -1;
    AudioFormat      format_info{};
    bool             opened = false;

    // Resampled output buffer (interleaved float32).
    std::vector<float> pcm_buffer;
};

// ── Construction / destruction ───────────────────────────────────────────────

FFmpegDecoder::FFmpegDecoder()
    : m_impl(std::make_unique<Impl>())
{}

FFmpegDecoder::~FFmpegDecoder()
{
    close();
}

// ── open ─────────────────────────────────────────────────────────────────────

int FFmpegDecoder::open(const char* path)
{
    if (!path) return -1;
    close(); // ensure clean state

    auto& d = *m_impl;

    // --- Open container ---
    if (avformat_open_input(&d.fmt_ctx, path, nullptr, nullptr) < 0)
        return -1;

    if (avformat_find_stream_info(d.fmt_ctx, nullptr) < 0) {
        avformat_close_input(&d.fmt_ctx);
        return -1;
    }

    // --- Find best audio stream ---
    d.audio_stream_idx = av_find_best_stream(
        d.fmt_ctx, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);

    if (d.audio_stream_idx < 0) {
        avformat_close_input(&d.fmt_ctx);
        return -1;
    }

    const AVStream* stream = d.fmt_ctx->streams[d.audio_stream_idx];
    const AVCodec*  codec  = avcodec_find_decoder(stream->codecpar->codec_id);
    if (!codec) {
        avformat_close_input(&d.fmt_ctx);
        return -1;
    }

    // --- Allocate codec context ---
    d.codec_ctx = avcodec_alloc_context3(codec);
    if (!d.codec_ctx) {
        avformat_close_input(&d.fmt_ctx);
        return -1;
    }

    if (avcodec_parameters_to_context(d.codec_ctx, stream->codecpar) < 0) {
        avcodec_free_context(&d.codec_ctx);
        avformat_close_input(&d.fmt_ctx);
        return -1;
    }

    if (avcodec_open2(d.codec_ctx, codec, nullptr) < 0) {
        avcodec_free_context(&d.codec_ctx);
        avformat_close_input(&d.fmt_ctx);
        return -1;
    }

    // --- Set up SwrContext (any input → float32 interleaved) ---
    AVChannelLayout out_layout;
    av_channel_layout_default(&out_layout, d.codec_ctx->ch_layout.nb_channels);

    if (swr_alloc_set_opts2(
            &d.swr_ctx,
            &out_layout,                  // output layout
            AV_SAMPLE_FMT_FLT,           // output format: float32 interleaved
            d.codec_ctx->sample_rate,     // keep native sample rate
            &d.codec_ctx->ch_layout,      // input layout
            d.codec_ctx->sample_fmt,      // input format
            d.codec_ctx->sample_rate,
            0, nullptr) < 0)
    {
        avcodec_free_context(&d.codec_ctx);
        avformat_close_input(&d.fmt_ctx);
        return -1;
    }

    if (swr_init(d.swr_ctx) < 0) {
        swr_free(&d.swr_ctx);
        avcodec_free_context(&d.codec_ctx);
        avformat_close_input(&d.fmt_ctx);
        return -1;
    }

    // --- Allocate packet + frame ---
    d.packet = av_packet_alloc();
    d.frame  = av_frame_alloc();

    // --- Fill format info ---
    std::strncpy(d.format_info.codec_name, codec->name,
                 sizeof(d.format_info.codec_name) - 1);
    d.format_info.sample_rate = static_cast<uint32_t>(d.codec_ctx->sample_rate);
    d.format_info.channels    = static_cast<uint8_t>(d.codec_ctx->ch_layout.nb_channels);
    d.format_info.bit_depth   = static_cast<uint8_t>(
        d.codec_ctx->bits_per_raw_sample > 0
            ? d.codec_ctx->bits_per_raw_sample
            : av_get_bytes_per_sample(d.codec_ctx->sample_fmt) * 8);
    d.format_info.duration_ms =
        d.fmt_ctx->duration > 0
            ? static_cast<uint64_t>(d.fmt_ctx->duration / (AV_TIME_BASE / 1000))
            : 0;

    d.opened = true;
    return 0;
}

// ── close ────────────────────────────────────────────────────────────────────

void FFmpegDecoder::close()
{
    auto& d = *m_impl;
    if (d.frame)     { av_frame_free(&d.frame);     }
    if (d.packet)    { av_packet_free(&d.packet);    }
    if (d.swr_ctx)   { swr_free(&d.swr_ctx);        }
    if (d.codec_ctx) { avcodec_free_context(&d.codec_ctx); }
    if (d.fmt_ctx)   { avformat_close_input(&d.fmt_ctx);   }
    d.audio_stream_idx = -1;
    d.opened = false;
    d.format_info = {};
    d.pcm_buffer.clear();
}

// ── format ───────────────────────────────────────────────────────────────────

const AudioFormat& FFmpegDecoder::format() const
{
    return m_impl->format_info;
}

// ── decode_next_frame ────────────────────────────────────────────────────────

DecodedBuffer FFmpegDecoder::decode_next_frame()
{
    auto& d = *m_impl;
    if (!d.opened) return {nullptr, 0};

    while (true) {
        // Pull decoded frames already queued in the codec
        int ret = avcodec_receive_frame(d.codec_ctx, d.frame);
        if (ret == 0) {
            // Resample / convert to float32 interleaved
            const int out_samples = swr_get_out_samples(d.swr_ctx, d.frame->nb_samples);
            const int channels    = d.format_info.channels;
            d.pcm_buffer.resize(static_cast<size_t>(out_samples * channels));

            uint8_t* out_ptr = reinterpret_cast<uint8_t*>(d.pcm_buffer.data());
            const int converted = swr_convert(
                d.swr_ctx,
                &out_ptr, out_samples,
                const_cast<const uint8_t**>(d.frame->extended_data),
                d.frame->nb_samples);

            if (converted <= 0) return {nullptr, 0};

            return {d.pcm_buffer.data(), static_cast<uint32_t>(converted)};
        }

        if (ret != AVERROR(EAGAIN)) {
            // EOF or real error
            return {nullptr, 0};
        }

        // Need more packets
        while (true) {
            ret = av_read_frame(d.fmt_ctx, d.packet);
            if (ret < 0) {
                // EOF — flush decoder
                avcodec_send_packet(d.codec_ctx, nullptr);
                break;
            }
            if (d.packet->stream_index == d.audio_stream_idx) {
                avcodec_send_packet(d.codec_ctx, d.packet);
                av_packet_unref(d.packet);
                break;
            }
            av_packet_unref(d.packet);
        }

        // If av_read_frame returned EOF and flush packet sent,
        // loop back to receive_frame to drain decoder
        if (ret < 0) {
            ret = avcodec_receive_frame(d.codec_ctx, d.frame);
            if (ret == 0) {
                const int out_samples = swr_get_out_samples(d.swr_ctx, d.frame->nb_samples);
                const int channels    = d.format_info.channels;
                d.pcm_buffer.resize(static_cast<size_t>(out_samples * channels));

                uint8_t* out_ptr = reinterpret_cast<uint8_t*>(d.pcm_buffer.data());
                const int converted = swr_convert(
                    d.swr_ctx,
                    &out_ptr, out_samples,
                    const_cast<const uint8_t**>(d.frame->extended_data),
                    d.frame->nb_samples);

                if (converted <= 0) return {nullptr, 0};
                return {d.pcm_buffer.data(), static_cast<uint32_t>(converted)};
            }
            return {nullptr, 0}; // true EOF
        }
    }
}

// ── seek ─────────────────────────────────────────────────────────────────────

int FFmpegDecoder::seek(uint64_t position_ms)
{
    auto& d = *m_impl;
    if (!d.opened) return -1;

    const int64_t ts = static_cast<int64_t>(position_ms) * (AV_TIME_BASE / 1000);
    if (av_seek_frame(d.fmt_ctx, -1, ts, AVSEEK_FLAG_BACKWARD) < 0)
        return -1;

    avcodec_flush_buffers(d.codec_ctx);
    return 0;
}

// ── is_open ──────────────────────────────────────────────────────────────────

bool FFmpegDecoder::is_open() const
{
    return m_impl->opened;
}

} // namespace ace
