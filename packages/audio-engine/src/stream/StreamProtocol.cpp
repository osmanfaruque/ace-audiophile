#include "ace_engine.h"

extern "C" {
#include <libavformat/avio.h>
}

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <chrono>
#include <fstream>
#include <sstream>
#include <string>
#include <thread>

namespace {

std::string trim(const std::string& s)
{
    size_t b = 0;
    while (b < s.size() && std::isspace(static_cast<unsigned char>(s[b]))) {
        ++b;
    }
    size_t e = s.size();
    while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1]))) {
        --e;
    }
    return s.substr(b, e - b);
}

std::string to_lower(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return s;
}

bool starts_with(const std::string& value, const char* prefix)
{
    const std::string p(prefix);
    return value.size() >= p.size() && value.compare(0, p.size(), p) == 0;
}

void copy_cstr(char* dst, size_t cap, const std::string& src)
{
    if (!dst || cap == 0) {
        return;
    }
    std::snprintf(dst, cap, "%s", src.c_str());
}

std::string resolve_url(const std::string& base_url, const std::string& uri)
{
    if (uri.empty()) {
        return uri;
    }
    if (starts_with(uri, "http://") || starts_with(uri, "https://")) {
        return uri;
    }

    if (base_url.empty()) {
        return uri;
    }

    const size_t scheme_pos = base_url.find("://");
    if (scheme_pos == std::string::npos) {
        return uri;
    }

    const size_t host_start = scheme_pos + 3;
    const size_t path_start = base_url.find('/', host_start);
    const std::string origin = (path_start == std::string::npos)
        ? base_url
        : base_url.substr(0, path_start);

    if (!uri.empty() && uri[0] == '/') {
        return origin + uri;
    }

    const size_t last_slash = base_url.rfind('/');
    if (last_slash == std::string::npos || last_slash < host_start) {
        return origin + "/" + uri;
    }
    return base_url.substr(0, last_slash + 1) + uri;
}

std::string icy_value_from_line(const std::string& lower_line, const std::string& line,
                                const char* key)
{
    const std::string k(key);
    if (!starts_with(lower_line, k.c_str())) {
        return {};
    }
    const size_t pos = line.find(':');
    if (pos == std::string::npos) {
        return {};
    }
    return trim(line.substr(pos + 1));
}

int append_url_bytes_to_file(const std::string& url, std::ofstream& out)
{
    AVIOContext* io = nullptr;
    if (avio_open2(&io, url.c_str(), AVIO_FLAG_READ, nullptr, nullptr) < 0 || !io) {
        return -1;
    }

    uint8_t buf[16 * 1024];
    while (true) {
        const int n = avio_read(io, buf, static_cast<int>(sizeof(buf)));
        if (n == 0 || avio_feof(io)) {
            break;
        }
        if (n < 0) {
            avio_closep(&io);
            return -2;
        }
        out.write(reinterpret_cast<const char*>(buf), n);
        if (!out.good()) {
            avio_closep(&io);
            return -3;
        }
    }

    avio_closep(&io);
    return 0;
}

std::string extract_quoted_value(const std::string& input, const char* key)
{
    const std::string k(key);
    const size_t key_pos = input.find(k);
    if (key_pos == std::string::npos) {
        return {};
    }
    const size_t quote_start = input.find('\'', key_pos + k.size());
    if (quote_start == std::string::npos) {
        return {};
    }
    const size_t quote_end = input.find('\'', quote_start + 1);
    if (quote_end == std::string::npos || quote_end <= quote_start) {
        return {};
    }
    return input.substr(quote_start + 1, quote_end - quote_start - 1);
}

} // namespace

int ace_parse_icy_headers(const char* headers_blob, AceIcyHeaderInfo* out)
{
    if (!headers_blob || !out) {
        return -1;
    }

    std::memset(out, 0, sizeof(*out));

    std::istringstream iss(headers_blob);
    std::string line;
    while (std::getline(iss, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }

        const std::string trimmed = trim(line);
        const std::string lower = to_lower(trimmed);

        const std::string meta_enabled = icy_value_from_line(lower, trimmed, "icy-metadata");
        if (!meta_enabled.empty()) {
            out->metadata_enabled = (meta_enabled == "1") ? 1 : 0;
            continue;
        }

        const std::string metaint = icy_value_from_line(lower, trimmed, "icy-metaint");
        if (!metaint.empty()) {
            out->metaint = static_cast<uint32_t>(std::strtoul(metaint.c_str(), nullptr, 10));
            continue;
        }

        const std::string bitrate = icy_value_from_line(lower, trimmed, "icy-br");
        if (!bitrate.empty()) {
            out->bitrate_kbps = static_cast<uint32_t>(std::strtoul(bitrate.c_str(), nullptr, 10));
            continue;
        }

        const std::string name = icy_value_from_line(lower, trimmed, "icy-name");
        if (!name.empty()) {
            copy_cstr(out->name, sizeof(out->name), name);
            continue;
        }

        const std::string genre = icy_value_from_line(lower, trimmed, "icy-genre");
        if (!genre.empty()) {
            copy_cstr(out->genre, sizeof(out->genre), genre);
            continue;
        }

        const std::string url = icy_value_from_line(lower, trimmed, "icy-url");
        if (!url.empty()) {
            copy_cstr(out->url, sizeof(out->url), url);
            continue;
        }
    }

    if (out->metaint > 0) {
        out->metadata_enabled = 1;
    }
    return 0;
}

int ace_parse_icy_metadata_block(const uint8_t* block, uint32_t block_len, AceIcyMetadata* out)
{
    if (!block || !out || block_len == 0) {
        return -1;
    }

    std::memset(out, 0, sizeof(*out));

    std::string payload(reinterpret_cast<const char*>(block),
                        reinterpret_cast<const char*>(block) + block_len);

    // Trim trailing NUL padding from ICY metadata block.
    while (!payload.empty() && payload.back() == '\0') {
        payload.pop_back();
    }

    const std::string title = extract_quoted_value(payload, "StreamTitle=");
    const std::string url = extract_quoted_value(payload, "StreamUrl=");

    copy_cstr(out->stream_title, sizeof(out->stream_title), title);
    copy_cstr(out->stream_url, sizeof(out->stream_url), url);
    return 0;
}

int ace_stream_reconnect_backoff_ms(uint32_t attempt_index)
{
    if (attempt_index >= 3) {
        return -1;
    }
    // 500ms, 1000ms, 2000ms
    return static_cast<int>(500U << attempt_index);
}

int ace_parse_hls_m3u8(const char* m3u8_text, const char* base_url, AceHlsPlaylist* out)
{
    if (!m3u8_text || !out) {
        return -1;
    }

    std::memset(out, 0, sizeof(*out));
    const std::string base = base_url ? std::string(base_url) : std::string();

    std::istringstream iss(m3u8_text);
    std::string line;
    float pending_duration = 0.0f;

    while (std::getline(iss, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        const std::string t = trim(line);
        if (t.empty()) {
            continue;
        }

        if (starts_with(t, "#EXT-X-TARGETDURATION:")) {
            const std::string v = t.substr(std::strlen("#EXT-X-TARGETDURATION:"));
            out->target_duration = static_cast<uint32_t>(std::strtoul(v.c_str(), nullptr, 10));
            continue;
        }

        if (starts_with(t, "#EXTINF:")) {
            const size_t comma = t.find(',');
            const std::string v = t.substr(std::strlen("#EXTINF:"),
                                           (comma == std::string::npos)
                                               ? std::string::npos
                                               : comma - std::strlen("#EXTINF:"));
            pending_duration = std::strtof(v.c_str(), nullptr);
            continue;
        }

        if (t == "#EXT-X-ENDLIST") {
            out->is_live = 0;
            continue;
        }

        if (t[0] == '#') {
            continue;
        }

        if (out->segment_count >= ACE_HLS_MAX_SEGMENTS) {
            return -2;
        }

        AceHlsSegment& seg = out->segments[out->segment_count++];
        copy_cstr(seg.uri, sizeof(seg.uri), resolve_url(base, t));
        seg.duration_sec = pending_duration;
        pending_duration = 0.0f;
    }

    // Without EXT-X-ENDLIST, treat as live playlist.
    if (out->segment_count > 0 && out->is_live == 0) {
        const std::string text(m3u8_text);
        if (text.find("#EXT-X-ENDLIST") == std::string::npos) {
            out->is_live = 1;
        }
    }

    return static_cast<int>(out->segment_count);
}

int ace_download_and_stitch_hls(const AceHlsPlaylist* playlist, const char* output_path,
                                uint32_t max_segments)
{
    if (!playlist || !output_path) {
        return -1;
    }

    const uint32_t n = std::min<uint32_t>(playlist->segment_count, max_segments);
    if (n == 0) {
        return -2;
    }

    std::ofstream out(output_path, std::ios::binary | std::ios::trunc);
    if (!out.is_open()) {
        return -3;
    }

    for (uint32_t i = 0; i < n; ++i) {
        const std::string url = playlist->segments[i].uri;
        if (url.empty()) {
            return -4;
        }

        int result = -1;
        // A6.1.3 reconnect policy: 3 retries with exponential backoff.
        for (uint32_t attempt = 0; attempt < 3; ++attempt) {
            result = append_url_bytes_to_file(url, out);
            if (result == 0) {
                break;
            }
            const int delay_ms = ace_stream_reconnect_backoff_ms(attempt);
            if (delay_ms > 0) {
                std::this_thread::sleep_for(std::chrono::milliseconds(delay_ms));
            }
        }
        if (result != 0) {
            return -5;
        }
    }

    return 0;
}