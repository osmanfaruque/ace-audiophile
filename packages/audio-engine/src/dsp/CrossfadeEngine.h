#pragma once
#include <vector>
#include <cstdint>
#include <cmath>

/**
 * CrossfadeEngine — configurable track-to-track crossfade (A1.3.11).
 *
 * Manages a crossfade overlap between an outgoing track and an incoming track.
 * The audio thread feeds outgoing audio, and the engine mixes in the
 * beginning of the next track with an equal-power gain curve.
 *
 * Modes:
 *   - **Off**: no crossfade (instant or gapless transition).
 *   - **Crossfade**: overlap N ms with equal-power curve.
 *   - **Gapless**: defer to the decoder's gapless logic (A1.1.4).
 *
 * The engine does not decode audio itself — the caller must provide
 * "incoming" frames from the next track's decoder.
 */
class CrossfadeEngine {
public:
    enum class Mode : uint8_t {
        Off       = 0,
        Crossfade = 1,
        Gapless   = 2,
    };

    /** Configure crossfade parameters.
     *  @param mode        Crossfade mode.
     *  @param duration_ms Overlap duration in ms (100–12000).
     *  @param sample_rate Current playback sample rate (Hz).
     *  @param channels    Number of audio channels (1 or 2). */
    void configure(Mode mode, int duration_ms, float sample_rate, int channels);

    /** Begin a crossfade transition. Call when the outgoing track reaches
     *  its fade-out trigger point (duration_ms before EOF).
     *  After this, the caller must provide incoming audio via feed_incoming(). */
    void begin_crossfade();

    /** Feed incoming (next-track) audio into the crossfade buffer.
     *  @param data  Interleaved float32 PCM from the next track.
     *  @param frames Number of frames. */
    void feed_incoming(const float* data, int frames);

    /** Mix crossfade into the outgoing audio buffer in-place.
     *  Returns true while the crossfade is still in progress.
     *  When it returns false, the transition is complete and the caller
     *  should switch entirely to the incoming track.
     *  @param outgoing  Outgoing track's audio (interleaved, in-place).
     *  @param frames    Number of frames in the outgoing buffer. */
    bool process(float* outgoing, int frames);

    /** Reset state (abort any in-progress crossfade). */
    void reset();

    /** Whether a crossfade is currently in progress. */
    bool in_progress() const { return m_fading; }

    /** Whether crossfade mode is enabled (not Off/Gapless). */
    bool enabled() const { return m_mode == Mode::Crossfade; }

    /** Total crossfade duration in frames. */
    int duration_frames() const { return m_duration_frames; }

private:
    /** Equal-power crossfade gain at position t (0.0 = start, 1.0 = end).
     *  out_gain = cos(t * π/2),  in_gain = sin(t * π/2) */
    static float out_gain(float t) { return std::cos(t * static_cast<float>(M_PI) * 0.5f); }
    static float in_gain(float t)  { return std::sin(t * static_cast<float>(M_PI) * 0.5f); }

    Mode m_mode{Mode::Off};
    int  m_duration_frames{0};
    int  m_channels{2};

    // Crossfade state
    bool m_fading{false};
    int  m_fade_pos{0};            // current position in crossfade (frames)

    // Ring buffer for incoming audio
    std::vector<float> m_incoming;  // interleaved
    int m_in_write{0};             // write position (in frames)
    int m_in_read{0};              // read position (in frames)
    int m_in_count{0};             // frames available
};
