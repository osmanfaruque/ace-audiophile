#pragma once
#include <cstdint>
#include <string>

/**
 * LossyDetector — detect if a lossless container holds lossy-transcoded audio (A7.2.4).
 *
 * Two-pronged approach:
 *   1. Spectral cutoff fingerprint (A7.2.4.1): Lossy codecs remove high-frequency
 *      content above their Nyquist-equivalent ceiling. A sharp energy cliff at
 *      ~16 kHz (MP3 320), ~15 kHz (MP3 128), ~18 kHz (AAC) indicates transcoding.
 *   2. Codec chain sniffing (A7.2.4.2): Check if the container format is lossless
 *      (FLAC, WAV, AIFF) but the spectral signature matches a lossy original.
 *
 * The detector does NOT false-positive on:
 *   - Naturally band-limited recordings (e.g., AM radio archives)
 *   - Vinyl transfers with reduced HF content
 *   - Recordings mastered with aggressive HF rolloff
 * It uses the sharpness of the cutoff (dB/octave) as the key discriminator.
 */
class LossyDetector {
public:
    struct Result {
        bool     is_lossy_transcode;   ///< Primary verdict
        int      confidence;           ///< 0–100 confidence score
        uint32_t cutoff_hz;            ///< Detected spectral cutoff frequency
        float    cutoff_sharpness_db;  ///< Slope at cutoff (dB/octave); sharp = codec
        char     probable_source[32];  ///< e.g. "MP3 320", "MP3 128", "AAC 256"
        char     verdict[64];          ///< e.g. "genuine", "lossy_transcode", "suspect"
        char     explanation[256];     ///< Human-readable explanation
    };

    /**
     * Analyse a file for lossy transcode evidence.
     * @param path        Path to the audio file.
     * @param progress_cb Optional progress callback (0.0–1.0).
     * @param userdata    Opaque pointer forwarded to progress_cb.
     * @return 0 on success, negative on error.
     */
    int analyze(const char* path, Result& out,
                void (*progress_cb)(float, void*) = nullptr,
                void* userdata = nullptr);
};
