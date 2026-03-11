#pragma once
#include <cstdint>

/**
 * ReplayGain — loudness normalization with true-peak safety (A1.3.7).
 *
 * Applies a gain offset (from file metadata) so all tracks play at a
 * consistent perceived loudness.  Two modes:
 *
 *   - **Track mode**: per-track gain → consistent loudness across shuffled tracks.
 *   - **Album mode**: per-album gain → preserves inter-track dynamics within an album.
 *
 * True-peak limiter prevents inter-sample peaks from exceeding 0 dBTP
 * (or a user-specified ceiling).  Uses 4× oversampled peak detection
 * with a fast look-ahead soft-knee limiter.
 *
 * Chain position: first in the DSP pipeline (before PreAmp / EQ).
 */
class ReplayGain {
public:
    /** ReplayGain mode. */
    enum class Mode : uint8_t {
        Off   = 0,
        Track = 1,
        Album = 2,
    };

    /** Configure ReplayGain parameters.
     *  @param mode         Off / Track / Album
     *  @param track_gain   Per-track gain in dB (from metadata, e.g. −7.5)
     *  @param album_gain   Per-album gain in dB
     *  @param track_peak   Per-track true peak (linear, 0.0–1.0+)
     *  @param album_peak   Per-album true peak (linear)
     *  @param pre_amp      Additional gain offset in dB (user preference, e.g. +3)
     *  @param ceiling_db   True-peak ceiling in dBTP (default −1.0 for safety margin)
     *  @param sample_rate  Current sample rate in Hz */
    void configure(Mode mode, float track_gain, float album_gain,
                   float track_peak, float album_peak,
                   float pre_amp, float ceiling_db, float sample_rate);

    /** Process interleaved float32 audio in-place. */
    void process(float* buf, int frames, int channels);

    /** Reset limiter state (call on seek / track change). */
    void reset();

    /** Current effective gain in dB (for UI display). */
    float effective_gain_db() const { return m_effective_gain_db; }

private:
    /** 4× oversampled true-peak measurement for a single sample pair. */
    float true_peak_4x(float s0, float s1, float s2, float s3) const;

    Mode  m_mode{Mode::Off};
    float m_gain_linear{1.0f};       // combined RG gain
    float m_effective_gain_db{0.0f};
    float m_ceiling{0.891f};         // −1.0 dBTP default (linear)

    // Look-ahead soft-knee limiter state
    float m_limiter_env{0.0f};       // envelope follower
    float m_attack_coeff{0.0f};      // smoothing coefficients
    float m_release_coeff{0.0f};

    // 4× oversampling history per channel (for true-peak detection)
    static constexpr int kMaxChannels = 2;
    float m_hist[kMaxChannels][3]{};  // last 3 input samples per channel
};
