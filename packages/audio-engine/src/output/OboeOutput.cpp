#include "AudioOutput.h"
// Oboe low-latency output — Android
// TODO: implement using oboe::AudioStreamBuilder
class OboeOutput : public AudioOutput {
public:
    int  open(const char* device_id, uint32_t sample_rate, int channels) override;
    int  write(const float* buf, int frames) override;
    void close() override;
};
int  OboeOutput::open(const char*, uint32_t, int) { return 0; }
int  OboeOutput::write(const float*, int frames)  { return frames; }
void OboeOutput::close() {}
