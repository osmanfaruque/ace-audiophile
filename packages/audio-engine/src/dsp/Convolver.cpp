#include "Convolver.h"
#include <cmath>
#include <cstring>
#include <algorithm>
#include <fstream>

// ── Minimal WAV header parsing for IR loading ────────────────────────────────
// We only need basic PCM WAV support — IRs are typically short mono/stereo files.

namespace {

struct WavHeader {
    int      channels{0};
    int      sample_rate{0};
    int      bits_per_sample{0};
    int      data_size{0};
    bool     valid{false};
};

WavHeader parse_wav_header(const std::vector<uint8_t>& data)
{
    WavHeader h;
    if (data.size() < 44) return h;

    // RIFF header
    if (std::memcmp(data.data(), "RIFF", 4) != 0) return h;
    if (std::memcmp(data.data() + 8, "WAVE", 4) != 0) return h;

    // Find "fmt " chunk
    size_t pos = 12;
    while (pos + 8 <= data.size()) {
        uint32_t chunk_size = 0;
        std::memcpy(&chunk_size, data.data() + pos + 4, 4);

        if (std::memcmp(data.data() + pos, "fmt ", 4) == 0) {
            if (pos + 24 > data.size()) return h;
            uint16_t format = 0;
            std::memcpy(&format, data.data() + pos + 8, 2);
            if (format != 1 && format != 3) return h; // PCM or IEEE float only

            uint16_t ch = 0;
            std::memcpy(&ch, data.data() + pos + 10, 2);
            h.channels = ch;

            uint32_t sr = 0;
            std::memcpy(&sr, data.data() + pos + 12, 4);
            h.sample_rate = static_cast<int>(sr);

            uint16_t bps = 0;
            std::memcpy(&bps, data.data() + pos + 22, 2);
            h.bits_per_sample = bps;

            pos += 8 + chunk_size;
            continue;
        }

        if (std::memcmp(data.data() + pos, "data", 4) == 0) {
            h.data_size = static_cast<int>(chunk_size);
            h.valid = (h.channels > 0 && h.sample_rate > 0 && h.bits_per_sample > 0);
            // data starts at pos + 8
            // Store the offset in data_size (reusing field; actual samples start at pos+8)
            // Actually let's just record data position
            return h; // caller must find data at pos+8
        }

        pos += 8 + chunk_size;
        if (chunk_size & 1) ++pos; // align
    }
    return h;
}

// Read WAV file and return mono or stereo float samples
bool load_wav_to_float(const char* path,
                       std::vector<float>& out_l,
                       std::vector<float>& out_r,
                       int& out_sr)
{
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f.is_open()) return false;

    auto fsize = f.tellg();
    if (fsize <= 0 || fsize > 100 * 1024 * 1024) return false; // 100 MB cap
    f.seekg(0);

    std::vector<uint8_t> data(static_cast<size_t>(fsize));
    f.read(reinterpret_cast<char*>(data.data()), fsize);

    WavHeader hdr = parse_wav_header(data);
    if (!hdr.valid) return false;
    if (hdr.channels < 1 || hdr.channels > 2) return false;

    out_sr = hdr.sample_rate;

    // Find data chunk
    size_t pos = 12;
    const uint8_t* samples = nullptr;
    int data_size = 0;
    while (pos + 8 <= data.size()) {
        uint32_t chunk_size = 0;
        std::memcpy(&chunk_size, data.data() + pos + 4, 4);
        if (std::memcmp(data.data() + pos, "data", 4) == 0) {
            samples = data.data() + pos + 8;
            data_size = static_cast<int>(chunk_size);
            break;
        }
        pos += 8 + chunk_size;
        if (chunk_size & 1) ++pos;
    }
    if (!samples) return false;

    int bytes_per_sample = hdr.bits_per_sample / 8;
    int frame_size = bytes_per_sample * hdr.channels;
    int frame_count = data_size / frame_size;

    out_l.resize(static_cast<size_t>(frame_count));
    if (hdr.channels == 2)
        out_r.resize(static_cast<size_t>(frame_count));

    for (int i = 0; i < frame_count; ++i) {
        const uint8_t* frame_ptr = samples + i * frame_size;

        for (int ch = 0; ch < hdr.channels; ++ch) {
            const uint8_t* sp = frame_ptr + ch * bytes_per_sample;
            float val = 0.0f;

            if (hdr.bits_per_sample == 16) {
                int16_t s = 0;
                std::memcpy(&s, sp, 2);
                val = static_cast<float>(s) / 32768.0f;
            } else if (hdr.bits_per_sample == 24) {
                int32_t s = (static_cast<int32_t>(sp[2]) << 24)
                          | (static_cast<int32_t>(sp[1]) << 16)
                          | (static_cast<int32_t>(sp[0]) << 8);
                s >>= 8; // sign-extend
                val = static_cast<float>(s) / 8388608.0f;
            } else if (hdr.bits_per_sample == 32) {
                // Could be int32 or float32
                std::memcpy(&val, sp, 4);
                // If it looks like int32 (values > 2.0), normalize
                if (std::abs(val) > 2.0f) {
                    int32_t s = 0;
                    std::memcpy(&s, sp, 4);
                    val = static_cast<float>(s) / 2147483648.0f;
                }
            }

            if (ch == 0) out_l[i] = val;
            else         out_r[i] = val;
        }
    }

    return true;
}

// Simple linear resampling for IR (quality doesn't matter much for short IRs)
std::vector<float> resample_ir(const std::vector<float>& ir, int from_sr, int to_sr)
{
    if (from_sr == to_sr || ir.empty()) return ir;

    double ratio = static_cast<double>(to_sr) / from_sr;
    size_t out_len = static_cast<size_t>(ir.size() * ratio + 0.5);
    if (out_len == 0) return {};

    std::vector<float> out(out_len);
    for (size_t i = 0; i < out_len; ++i) {
        double src_pos = i / ratio;
        size_t idx = static_cast<size_t>(src_pos);
        float frac = static_cast<float>(src_pos - idx);
        if (idx + 1 < ir.size())
            out[i] = ir[idx] * (1.0f - frac) + ir[idx + 1] * frac;
        else if (idx < ir.size())
            out[i] = ir[idx];
    }
    return out;
}

} // anonymous namespace

int Convolver::load_ir(const char* path, float sample_rate)
{
    unload();

    std::vector<float> ir_l, ir_r;
    int ir_sr = 0;

    if (!load_wav_to_float(path, ir_l, ir_r, ir_sr))
        return -1;

    if (ir_l.empty())
        return -2;

    // Resample IR to match playback sample rate
    int target_sr = static_cast<int>(sample_rate);
    m_ir_l = resample_ir(ir_l, ir_sr, target_sr);
    if (!ir_r.empty())
        m_ir_r = resample_ir(ir_r, ir_sr, target_sr);

    // Initialize overlap buffers
    m_overlap_l.assign(m_ir_l.size() - 1, 0.0f);
    m_overlap_r.assign(m_ir_r.empty() ? m_ir_l.size() - 1 : m_ir_r.size() - 1, 0.0f);

    // Input accumulation buffers
    m_in_buf_l.resize(kBlockSize, 0.0f);
    m_in_buf_r.resize(kBlockSize, 0.0f);
    m_in_pos = 0;

    m_active = true;
    return 0;
}

void Convolver::unload()
{
    m_active = false;
    m_ir_l.clear();
    m_ir_r.clear();
    m_overlap_l.clear();
    m_overlap_r.clear();
    m_in_buf_l.clear();
    m_in_buf_r.clear();
    m_in_pos = 0;
}

void Convolver::convolve_channel(const float* input, float* output, int frames,
                                  const std::vector<float>& ir,
                                  std::vector<float>& overlap)
{
    int ir_len = static_cast<int>(ir.size());
    int ol_len = ir_len - 1;

    // Direct time-domain convolution for the block
    for (int n = 0; n < frames; ++n) {
        float sum = 0.0f;
        int k_max = std::min(n + 1, ir_len);
        for (int k = 0; k < k_max; ++k)
            sum += input[n - k] * ir[k];
        // Add overlap from previous block
        if (n < ol_len)
            sum += overlap[n];
        output[n] = sum;
    }

    // Compute new overlap: convolution tail that extends past the block
    int new_ol_len = std::min(ol_len, frames + ir_len - 1 - frames);
    for (int n = 0; n < ol_len; ++n) {
        float sum = 0.0f;
        for (int k = 0; k < ir_len; ++k) {
            int idx = (frames + n) - k;
            if (idx >= 0 && idx < frames)
                sum += input[idx] * ir[k];
        }
        overlap[n] = sum;
    }
}

void Convolver::process(float* buf, int frames, int channels)
{
    if (!m_active || channels < 1)
        return;

    // Process in blocks for cache efficiency
    int processed = 0;
    while (processed < frames) {
        int remaining = frames - processed;
        int space = kBlockSize - m_in_pos;
        int to_copy = std::min(remaining, space);

        // De-interleave into input buffers
        for (int i = 0; i < to_copy; ++i) {
            int src = (processed + i) * channels;
            m_in_buf_l[m_in_pos + i] = buf[src];
            m_in_buf_r[m_in_pos + i] = (channels > 1) ? buf[src + 1] : buf[src];
        }
        m_in_pos += to_copy;

        if (m_in_pos >= kBlockSize) {
            // Process a full block
            std::vector<float> out_l(kBlockSize);
            std::vector<float> out_r(kBlockSize);

            convolve_channel(m_in_buf_l.data(), out_l.data(), kBlockSize,
                             m_ir_l, m_overlap_l);
            convolve_channel(m_in_buf_r.data(), out_r.data(), kBlockSize,
                             m_ir_r.empty() ? m_ir_l : m_ir_r, m_overlap_r);

            // Write back interleaved — but we need to write to the correct
            // position in the original buffer. The block corresponds to
            // buf positions [processed - (kBlockSize - to_copy)] thru [processed + to_copy - 1]
            int block_start = processed + to_copy - kBlockSize;
            for (int i = 0; i < kBlockSize; ++i) {
                int dst = (block_start + i) * channels;
                buf[dst] = out_l[i];
                if (channels > 1) buf[dst + 1] = out_r[i];
            }

            m_in_pos = 0;
        }

        processed += to_copy;
    }
}

void Convolver::reset()
{
    if (!m_active) return;
    std::fill(m_overlap_l.begin(), m_overlap_l.end(), 0.0f);
    std::fill(m_overlap_r.begin(), m_overlap_r.end(), 0.0f);
    std::fill(m_in_buf_l.begin(), m_in_buf_l.end(), 0.0f);
    std::fill(m_in_buf_r.begin(), m_in_buf_r.end(), 0.0f);
    m_in_pos = 0;
}
