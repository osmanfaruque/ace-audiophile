#pragma once
#include <cstdint>

class AudioOutput {
public:
    virtual ~AudioOutput() = default;
    virtual int  open(const char* device_id, uint32_t sample_rate, int channels) = 0;
    virtual int  write(const float* buf, int frames) = 0;
    virtual void close() = 0;
    virtual bool supports_exclusive() const { return false; }
};
