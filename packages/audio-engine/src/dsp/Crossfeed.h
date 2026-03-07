#pragma once

class Crossfeed {
public:
    void set_strength(float strength);  // 0.0 – 1.0
    void process(float* buf, int frames, int channels);
private:
    float m_strength{0.0f};
};
