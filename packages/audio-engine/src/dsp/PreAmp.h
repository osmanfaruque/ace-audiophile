#pragma once
#include <atomic>
#include <cstdint>

/**
 * PreAmp — digital gain stage with per-channel clip detection (A1.3.2).
 *
 * Applies a configurable gain (±20 dB) to the signal buffer.
 * Tracks per-channel peak levels and counts clipped samples
 * (samples that exceed ±1.0 before clamping).
 *
 * Clip statistics are accumulated and can be polled / reset
 * from any thread (atomic counters).
 */
class PreAmp {
public:
    /** Set gain in dB (clamped to ±20 dB).  Thread-safe. */
    void set_gain_db(float db);

    /** Current gain in dB. */
    float gain_db() const { return m_gain_db; }

    /** Apply gain to interleaved float32 PCM.
     *  After this call, peak_l/peak_r and clip counts are updated. */
    void process(float* buf, int frames, int channels);

    /** Reset clip counters and peak trackers. */
    void reset_stats();

    // ── Clip statistics (lock-free, readable from any thread) ────────────

    /** Peak sample level (linear, 0.0–∞) since last reset, per channel. */
    float peak_l() const { return m_peak_l.load(std::memory_order_relaxed); }
    float peak_r() const { return m_peak_r.load(std::memory_order_relaxed); }

    /** Number of samples that clipped (>1.0 or <-1.0) since last reset. */
    uint64_t clip_count_l() const { return m_clips_l.load(std::memory_order_relaxed); }
    uint64_t clip_count_r() const { return m_clips_r.load(std::memory_order_relaxed); }

    /** True if any clipping occurred since last reset. */
    bool clipped() const { return (m_clips_l.load(std::memory_order_relaxed)
                                 + m_clips_r.load(std::memory_order_relaxed)) > 0; }

private:
    float m_gain_db{0.0f};
    float m_gain_linear{1.0f};

    std::atomic<float>    m_peak_l{0.0f};
    std::atomic<float>    m_peak_r{0.0f};
    std::atomic<uint64_t> m_clips_l{0};
    std::atomic<uint64_t> m_clips_r{0};
};
