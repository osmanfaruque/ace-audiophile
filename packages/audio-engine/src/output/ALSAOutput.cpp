#include "AudioOutput.h"
// ALSA / PipeWire native output — Linux
// TODO: implement using snd_pcm_* or pw_stream_*
class ALSAOutput : public AudioOutput {
public:
    int  open(const char* device_id, uint32_t sample_rate, int channels) override;
    int  write(const float* buf, int frames) override;
    void close() override;
};
int  ALSAOutput::open(const char*, uint32_t, int) { return 0; }
int  ALSAOutput::write(const float*, int frames)  { return frames; }
void ALSAOutput::close() {}
