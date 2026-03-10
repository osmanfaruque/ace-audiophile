#pragma once
#include "AudioOutput.h"

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

struct WASAPIImpl;
struct DeviceNotificationClient;

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
    static std::vector<WasapiDeviceInfo> enumerate_devices();

    // ── A1.2.5  Hot-plug detection ──────────────────────────────────────────
    enum class DeviceEvent { Added, Removed, DefaultChanged, StateChanged };
    using DeviceChangeCallback = std::function<void(DeviceEvent, const std::string& device_id)>;

    /** Start listening for device add/remove/default-change events.
     *  Callback fires on a COM background thread. */
    static bool start_hotplug(DeviceChangeCallback cb);

    /** Stop listening for device change events. */
    static void stop_hotplug();

    // ── A1.2.6  Bit-perfect chain verification ──────────────────────────────
    struct BitPerfectResult {
        bool     passed       = false;
        uint32_t sample_rate  = 0;
        int      bit_depth    = 0;
        bool     exclusive    = false;
        float    hash_match   = 0.0f;  /**< 0.0–1.0; 1.0 = perfect */
        char     detail[256]  = {};
    };

    /** Generate a known test tone, play through the configured output,
     *  then verify the signal chain by comparing the rendered samples.
     *  device_id may be nullptr for the default device. */
    static BitPerfectResult verify_bitperfect(const char* device_id);

private:
    std::unique_ptr<WASAPIImpl> m_impl;
};
