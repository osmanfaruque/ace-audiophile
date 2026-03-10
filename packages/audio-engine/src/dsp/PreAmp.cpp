/**
 * PreAmp.cpp — digital gain stage with clip detection (A1.3.2)
 *
 * Applies gain in the linear domain (converted from dB).
 * Tracks per-channel peak and accumulated clip count so the
 * front-end can display a clip indicator.
 */
#include "PreAmp.h"
#include <cmath>
#include <algorithm>

void PreAmp::set_gain_db(float db)
{
    db = std::clamp(db, -20.0f, 20.0f);
    m_gain_db     = db;
    m_gain_linear = std::pow(10.0f, db / 20.0f);
}

void PreAmp::process(float* buf, int frames, int channels)
{
    if (m_gain_linear == 1.0f) {
        // Unity gain — still track peaks for metering
        float pk_l = m_peak_l.load(std::memory_order_relaxed);
        float pk_r = m_peak_r.load(std::memory_order_relaxed);

        for (int f = 0; f < frames; ++f) {
            float al = std::fabs(buf[f * channels]);
            if (al > pk_l) pk_l = al;

            if (channels >= 2) {
                float ar = std::fabs(buf[f * channels + 1]);
                if (ar > pk_r) pk_r = ar;
            }
        }
        m_peak_l.store(pk_l, std::memory_order_relaxed);
        m_peak_r.store(pk_r, std::memory_order_relaxed);
        return;
    }

    const float g = m_gain_linear;
    const int total = frames * channels;

    float pk_l = m_peak_l.load(std::memory_order_relaxed);
    float pk_r = m_peak_r.load(std::memory_order_relaxed);
    uint64_t cl = 0;
    uint64_t cr = 0;

    for (int f = 0; f < frames; ++f) {
        // Left channel (or mono)
        float& sl = buf[f * channels];
        sl *= g;
        float al = std::fabs(sl);
        if (al > pk_l) pk_l = al;
        if (al > 1.0f) ++cl;

        // Right channel
        if (channels >= 2) {
            float& sr = buf[f * channels + 1];
            sr *= g;
            float ar = std::fabs(sr);
            if (ar > pk_r) pk_r = ar;
            if (ar > 1.0f) ++cr;
        }
    }

    m_peak_l.store(pk_l, std::memory_order_relaxed);
    m_peak_r.store(pk_r, std::memory_order_relaxed);
    m_clips_l.fetch_add(cl, std::memory_order_relaxed);
    m_clips_r.fetch_add(cr, std::memory_order_relaxed);
}

void PreAmp::reset_stats()
{
    m_peak_l.store(0.0f, std::memory_order_relaxed);
    m_peak_r.store(0.0f, std::memory_order_relaxed);
    m_clips_l.store(0, std::memory_order_relaxed);
    m_clips_r.store(0, std::memory_order_relaxed);
}
