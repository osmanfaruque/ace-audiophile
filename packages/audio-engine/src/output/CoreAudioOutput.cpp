#include "AudioOutput.h"
// CoreAudio hog-mode output — macOS / iOS
// TODO: implement using AudioUnit / AVAudioEngine
class CoreAudioOutput : public AudioOutput {
public:
    int  open(const char* device_id, uint32_t sample_rate, int channels) override;
    int  write(const float* buf, int frames) override;
    void close() override;
    bool supports_exclusive() const override { return true; }
};
int  CoreAudioOutput::open(const char*, uint32_t, int) { return 0; }
int  CoreAudioOutput::write(const float*, int frames)  { return frames; }
void CoreAudioOutput::close() {}
