#pragma once
#include <cstdint>
#include <cstddef>

/**
 * High-quality polyphase sample-rate converter backed by libsoxr.
 *
 * Uses SOXR_VHQ (Very High Quality) with linear phase — the audiophile
 * standard for transparent, artefact-free conversion.
 *
 * Internally manages a soxr_t instance.  Thread-safety: NOT thread-safe;
 * call configure/reset from the same thread as process, or protect externally.
 */
class Resampler {
public:
    Resampler() = default;
    ~Resampler();

    Resampler(const Resampler&) = delete;
    Resampler& operator=(const Resampler&) = delete;

    /** (Re-)create the soxr instance.
     *  @return true on success.  When in_hz == out_hz the resampler is inactive. */
    bool configure(uint32_t in_hz, uint32_t out_hz, int channels);

    /** Process interleaved float32 audio.
     *  @return number of output frames written to @p out. */
    int process(const float* in, int in_frames, float* out, int out_cap);

    /** Flush any remaining samples (call at end of track).
     *  @return frames written. */
    int flush(float* out, int out_cap);

    /** Reset internal filter state (e.g. on seek). Keeps configuration. */
    void reset();

    bool     active()            const { return m_active; }
    double   ratio()             const;
    int      max_output_frames(int in_frames) const;
    uint32_t output_rate()       const { return m_out_hz; }
    uint32_t in_hz()             const { return m_in_hz; }
    int      channels()          const { return m_channels; }

private:
    void destroy();

    void*    m_soxr{nullptr};   // soxr_t (opaque — avoids soxr.h in header)
    uint32_t m_in_hz{0};
    uint32_t m_out_hz{0};
    int      m_channels{2};
    bool     m_active{false};
};
