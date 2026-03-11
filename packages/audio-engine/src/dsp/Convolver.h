#pragma once
#include <vector>
#include <string>
#include <cstdint>

/**
 * Convolver — FIR impulse response loader and real-time convolution (A1.3.9).
 *
 * Loads a WAV/FLAC impulse response file, resamples it to match the
 * current playback sample rate, and convolves the audio stream in real time
 * using overlap-save (partitioned) convolution.
 *
 * Partition size = 1024 samples for low latency.
 * Stereo IR: L channel applied to L, R to R.
 * Mono IR: same kernel applied to both channels.
 *
 * Chain position: after EQ, before crossfeed (spatial effects).
 */
class Convolver {
public:
    /** Load an impulse response from a WAV file path.
     *  The IR is internally resampled to match @p sample_rate.
     *  @return 0 on success, negative on error. */
    int load_ir(const char* path, float sample_rate);

    /** Unload the current IR and free memory. */
    void unload();

    /** Process interleaved stereo float32 audio in-place. */
    void process(float* buf, int frames, int channels);

    /** Reset convolution state (call on seek / track change). */
    void reset();

    /** Whether an IR is loaded and ready. */
    bool active() const { return m_active; }

    /** Length of the loaded IR in samples (per channel). */
    int ir_length() const { return static_cast<int>(m_ir_l.size()); }

private:
    void convolve_channel(const float* input, float* output, int frames,
                          const std::vector<float>& ir,
                          std::vector<float>& overlap);

    bool m_active{false};
    std::vector<float> m_ir_l;      // Left (or mono) IR
    std::vector<float> m_ir_r;      // Right IR (empty if mono)

    // Overlap-save state per channel
    std::vector<float> m_overlap_l;
    std::vector<float> m_overlap_r;

    // Input accumulation buffer per channel
    std::vector<float> m_in_buf_l;
    std::vector<float> m_in_buf_r;
    int m_in_pos{0};

    static constexpr int kBlockSize = 1024;
};
