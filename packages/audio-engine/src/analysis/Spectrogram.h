#pragma once
#include "ace_engine.h"
#include <array>
#include <deque>
#include <mutex>

class Spectrogram {
public:
    Spectrogram();
    ~Spectrogram();

    /** Run Short-Time Fourier Transform on interleaved PCM.
     *  Returns an AceFftFrame populated with per-channel magnitude bins. */
    void compute(const float* pcm, int frames, int channels, int sample_rate, AceFftFrame& out);

    /** Compute peak & RMS level meter from interleaved stereo PCM. */
    static void compute_levels(const float* pcm, int frames, int channels, AceLevelMeter& out);

    /** Thread-safe snapshot of the last computed FFT + level. */
    void get_last(AceFftFrame& fft, AceLevelMeter& lvl) const;
    void store_last(const AceFftFrame& fft, const AceLevelMeter& lvl);

    int set_stft_config(const AceStftConfig& cfg);
    int set_channel_mode(uint8_t mode);
    int get_channel_ring(uint8_t channel_index, float* out_bins,
                         int max_frames, int* out_frames, int* out_bins_per_frame) const;

private:
    mutable std::mutex m_snap_mtx;
    AceFftFrame   m_last_fft{};
    AceLevelMeter m_last_lvl{};

    AceStftConfig m_cfg{};
    uint8_t m_channel_mode = ACE_SPEC_MODE_STEREO;

    static constexpr int kRingCapacity = 240;
    std::deque<std::array<float, ACE_FFT_BINS>> m_ring_ch0;
    std::deque<std::array<float, ACE_FFT_BINS>> m_ring_ch1;
};
