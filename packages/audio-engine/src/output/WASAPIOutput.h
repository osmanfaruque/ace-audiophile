#pragma once
#include "AudioOutput.h"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

struct WASAPIImpl;

struct WasapiDeviceInfo {
    std::string id;
    std::string name;
    uint32_t    max_sample_rate    = 0;
    bool        supports_exclusive = true;
    bool        is_default         = false;
};

class WASAPIOutput : public AudioOutput {
public:
    WASAPIOutput();
    ~WASAPIOutput() override;

    int  open(const char* device_id, uint32_t sample_rate, int channels) override;
    int  write(const float* buf, int frames) override;
    void close() override;
    bool supports_exclusive() const override { return true; }

    /** True if the current session is running in exclusive mode. */
    bool is_exclusive() const;

    /** Actual sample rate the device accepted (may differ from requested). */
    uint32_t actual_sample_rate() const;

    /** Actual bit depth the device accepted. */
    int actual_bit_depth() const;

    // ── A1.2.1  Device enumeration ──────────────────────────────────────────
    /** Enumerate all active WASAPI render endpoints.
     *  The default device (if found) has is_default == true. */
    static std::vector<WasapiDeviceInfo> enumerate_devices();

private:
    std::unique_ptr<WASAPIImpl> m_impl;
};
