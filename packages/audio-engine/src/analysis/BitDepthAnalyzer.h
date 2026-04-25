#pragma once
#include <cstdint>
#include <vector>

/**
 * BitDepthAnalyzer — detect effective bit depth via LSB histogram (A7.2.3.1).
 *
 * Strategy: decode the entire file, build a histogram of the lowest N bits of
 * each sample (converted to integer representation). If the lowest bits are
 * consistently zero (zero-padded), the effective depth is less than declared.
 *
 * Example: 16-bit audio upsampled to 24-bit will have the lower 8 bits always
 * zero, yielding effective_bit_depth = 16.
 *
 * Additionally performs spectral ceiling analysis (A7.2.3.2): if high-frequency
 * energy above Nyquist/2 of a lower sample rate is negligibly small, the source
 * was likely upsampled from a lower rate.
 */
class BitDepthAnalyzer {
public:
    struct Result {
        uint8_t  declared_bit_depth;    ///< Container-reported bit depth
        uint8_t  effective_bit_depth;   ///< Detected effective bit depth
        bool     is_fake;               ///< true if effective < declared
        float    zero_pad_ratio;        ///< Fraction of samples with zero LSBs
        uint32_t spectral_ceiling_hz;   ///< Estimated frequency ceiling (0 = not analysed)
        float    lsb_histogram[32];     ///< Per-bit usage ratio (bit 0 = LSB)
    };

    /**
     * Analyse a file for bit-depth authenticity.
     * @param path        Path to the audio file.
     * @param progress_cb Optional progress callback (0.0–1.0).
     * @param userdata    Opaque pointer forwarded to progress_cb.
     * @return 0 on success, negative on error.
     */
    int analyze(const char* path, Result& out,
                void (*progress_cb)(float, void*) = nullptr,
                void* userdata = nullptr);
};
