#include "CrossfadeEngine.h"
#include <cstring>
#include <algorithm>

void CrossfadeEngine::configure(Mode mode, int duration_ms, float sample_rate, int channels)
{
    m_mode     = mode;
    m_channels = std::max(channels, 1);

    duration_ms = std::clamp(duration_ms, 100, 12000);
    m_duration_frames = static_cast<int>(duration_ms * 0.001f * sample_rate + 0.5f);

    // Allocate incoming buffer (enough for full crossfade duration)
    m_incoming.resize(static_cast<size_t>(m_duration_frames * m_channels), 0.0f);
    m_in_write = 0;
    m_in_read  = 0;
    m_in_count = 0;
    m_fading   = false;
    m_fade_pos = 0;
}

void CrossfadeEngine::begin_crossfade()
{
    if (m_mode != Mode::Crossfade) return;

    m_fading   = true;
    m_fade_pos = 0;
    m_in_write = 0;
    m_in_read  = 0;
    m_in_count = 0;
    std::fill(m_incoming.begin(), m_incoming.end(), 0.0f);
}

void CrossfadeEngine::feed_incoming(const float* data, int frames)
{
    if (!m_fading || !data || frames <= 0) return;

    int buf_frames = m_duration_frames;
    for (int i = 0; i < frames && m_in_count < buf_frames; ++i) {
        int dst = m_in_write * m_channels;
        for (int c = 0; c < m_channels; ++c)
            m_incoming[dst + c] = data[i * m_channels + c];
        m_in_write = (m_in_write + 1) % buf_frames;
        ++m_in_count;
    }
}

bool CrossfadeEngine::process(float* outgoing, int frames)
{
    if (!m_fading || m_mode != Mode::Crossfade)
        return false;

    int buf_frames = m_duration_frames;

    for (int i = 0; i < frames; ++i) {
        if (m_fade_pos >= m_duration_frames) {
            // Crossfade complete — fill remainder with incoming audio
            if (m_in_count > 0) {
                int src = m_in_read * m_channels;
                for (int c = 0; c < m_channels; ++c)
                    outgoing[i * m_channels + c] = m_incoming[src + c];
                m_in_read = (m_in_read + 1) % buf_frames;
                --m_in_count;
            } else {
                // No more incoming audio — silence
                for (int c = 0; c < m_channels; ++c)
                    outgoing[i * m_channels + c] = 0.0f;
            }
            continue;
        }

        float t = static_cast<float>(m_fade_pos) / static_cast<float>(m_duration_frames);
        float g_out = out_gain(t);
        float g_in  = in_gain(t);

        // Get incoming sample (or silence if buffer underrun)
        float in_l = 0.0f, in_r = 0.0f;
        if (m_in_count > 0) {
            int src = m_in_read * m_channels;
            in_l = m_incoming[src];
            in_r = (m_channels > 1) ? m_incoming[src + 1] : in_l;
            m_in_read = (m_in_read + 1) % buf_frames;
            --m_in_count;
        }

        // Mix
        outgoing[i * m_channels]     = outgoing[i * m_channels]     * g_out + in_l * g_in;
        if (m_channels > 1)
            outgoing[i * m_channels + 1] = outgoing[i * m_channels + 1] * g_out + in_r * g_in;

        ++m_fade_pos;
    }

    // Return true if crossfade is still in progress
    if (m_fade_pos >= m_duration_frames) {
        m_fading = false;
        return false; // transition complete
    }
    return true;
}

void CrossfadeEngine::reset()
{
    m_fading   = false;
    m_fade_pos = 0;
    m_in_write = 0;
    m_in_read  = 0;
    m_in_count = 0;
    std::fill(m_incoming.begin(), m_incoming.end(), 0.0f);
}
