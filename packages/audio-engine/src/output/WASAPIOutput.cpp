#include "AudioOutput.h"
// WASAPI exclusive-mode output backend
// TODO: implement using IAudioClient + AUDCLNT_SHAREMODE_EXCLUSIVE
class WASAPIOutput : public AudioOutput {
public:
    int  open(const char* device_id, uint32_t sample_rate, int channels) override;
    int  write(const float* buf, int frames) override;
    void close() override;
    bool supports_exclusive() const override { return true; }
};
int  WASAPIOutput::open(const char*, uint32_t, int) { return 0; }
int  WASAPIOutput::write(const float*, int frames)  { return frames; }
void WASAPIOutput::close() {}
