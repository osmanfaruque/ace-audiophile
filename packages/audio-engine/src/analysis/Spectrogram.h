#pragma once
#include "ace_engine.h"
#include <mutex>

struct kiss_fft_state;

class Spectrogram {
public:
    Spectrogram();
    ~Spectrogram();

    /** Run Short-Time Fourier Transform on interleaved stereo PCM.
     *  Returns an AceFftFrame populated with per-channel magnitude bins. */
    void compute(const float* pcm, int frames, int sample_rate, AceFftFrame& out);

    /** Compute peak & RMS level meter from interleaved stereo PCM. */
    static void compute_levels(const float* pcm, int frames, int channels, AceLevelMeter& out);

    /** Thread-safe snapshot of the last computed FFT + level. */
    void get_last(AceFftFrame& fft, AceLevelMeter& lvl) const;
    void store_last(const AceFftFrame& fft, const AceLevelMeter& lvl);

private:
    kiss_fft_state* m_cfg = nullptr;
    float  m_window[ACE_FFT_BINS]{};
    mutable std::mutex m_snap_mtx;
    AceFftFrame   m_last_fft{};
    AceLevelMeter m_last_lvl{};
};
