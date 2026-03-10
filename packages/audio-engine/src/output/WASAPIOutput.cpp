// ── A1.2  WASAPI output backend ──────────────────────────────────────────────
//
// A1.2.1 — IMMDeviceEnumerator endpoint enumeration
// A1.2.2 — AUDCLNT_SHAREMODE_EXCLUSIVE event-driven render loop
//
// Uses explicit GUID definitions for MinGW-w64 compatibility.

#include "output/WASAPIOutput.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <objbase.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <mmreg.h>
#include <propsys.h>
#include <propvarutil.h>
#include <avrt.h>

#include <atomic>
#include <chrono>
#include <cstring>
#include <memory>
#include <string>
#include <thread>
#include <vector>

// ── GUIDs (defined explicitly to avoid __uuidof / INITGUID quirks) ──────────

// CLSID_MMDeviceEnumerator  {BCDE0395-E52F-467C-8E3D-C4579291692E}
static const CLSID kCLSID_MMDevEnum = {
    0xBCDE0395, 0xE52F, 0x467C,
    {0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E}};

// IID_IMMDeviceEnumerator   {A95664D2-9614-4F35-A746-DE8DB63617E6}
static const IID kIID_IMMDevEnum = {
    0xA95664D2, 0x9614, 0x4F35,
    {0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6}};

// IID_IAudioClient          {1CB9AD4C-DBFA-4C32-B178-C2F568A703B2}
static const IID kIID_IAudioClient = {
    0x1CB9AD4C, 0xDBFA, 0x4C32,
    {0xB1, 0x78, 0xC2, 0xF5, 0x68, 0xA7, 0x03, 0xB2}};

// PKEY_Device_FriendlyName  {A45C254E-DF1C-4EFD-8020-67D146A850E0}, 14
static const PROPERTYKEY kPKEY_FriendlyName = {
    {0xA45C254E, 0xDF1C, 0x4EFD,
     {0x80, 0x20, 0x67, 0xD1, 0x46, 0xA8, 0x50, 0xE0}},
    14};

// IID_IAudioRenderClient    {F294ACFC-3146-4483-A7BF-ADDCA7C260E2}
static const IID kIID_IAudioRenderClient = {
    0xF294ACFC, 0x3146, 0x4483,
    {0xA7, 0xBF, 0xAD, 0xDC, 0xA7, 0xC2, 0x60, 0xE2}};

// KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {00000003-0000-0010-8000-00AA00389B71}
static const GUID kKSDATA_Float = {
    0x00000003, 0x0000, 0x0010,
    {0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71}};

#ifndef AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED
#define AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED  ((HRESULT)0x88890019L)
#endif

// ── Helpers ──────────────────────────────────────────────────────────────────

namespace {

/** Wide string → UTF-8 */
std::string wstr_to_utf8(const wchar_t* ws)
{
    if (!ws || !*ws) return {};
    int len = WideCharToMultiByte(CP_UTF8, 0, ws, -1, nullptr, 0, nullptr, nullptr);
    if (len <= 0) return {};
    std::string out(static_cast<size_t>(len - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, ws, -1, out.data(), len, nullptr, nullptr);
    return out;
}

/** UTF-8 → wide string */
std::wstring utf8_to_wstr(const char* s)
{
    if (!s || !*s) return {};
    int len = MultiByteToWideChar(CP_UTF8, 0, s, -1, nullptr, 0);
    if (len <= 0) return {};
    std::wstring out(static_cast<size_t>(len - 1), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s, -1, out.data(), len);
    return out;
}

/** RAII COM initialiser (per-thread). */
struct ComInit {
    HRESULT hr;
    ComInit()  { hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED); }
    ~ComInit() { if (SUCCEEDED(hr)) CoUninitialize(); }
    bool ok() const { return SUCCEEDED(hr) || hr == S_FALSE; /* already init'd */ }
};

/** Get device ID string (caller gets UTF-8). */
std::string device_id_utf8(IMMDevice* dev)
{
    LPWSTR raw = nullptr;
    if (FAILED(dev->GetId(&raw)) || !raw) return {};
    std::string s = wstr_to_utf8(raw);
    CoTaskMemFree(raw);
    return s;
}

/** Get device friendly name. */
std::string device_name_utf8(IMMDevice* dev)
{
    IPropertyStore* ps = nullptr;
    if (FAILED(dev->OpenPropertyStore(STGM_READ, &ps)) || !ps) return {};

    std::string name;
    PROPVARIANT pv;
    PropVariantInit(&pv);
    if (SUCCEEDED(ps->GetValue(kPKEY_FriendlyName, &pv))) {
        if (pv.vt == VT_LPWSTR && pv.pwszVal)
            name = wstr_to_utf8(pv.pwszVal);
    }
    PropVariantClear(&pv);
    ps->Release();
    return name;
}

/** Query the shared-mode mix format sample rate as a baseline.
 *  (True max rate is probed in A1.2.3 via IsFormatSupported.) */
uint32_t device_sample_rate(IMMDevice* dev)
{
    IAudioClient* ac = nullptr;
    if (FAILED(dev->Activate(kIID_IAudioClient, CLSCTX_ALL,
                             nullptr, reinterpret_cast<void**>(&ac))) || !ac)
        return 0;

    WAVEFORMATEX* wfx = nullptr;
    uint32_t rate = 0;
    if (SUCCEEDED(ac->GetMixFormat(&wfx)) && wfx) {
        rate = wfx->nSamplesPerSec;
        CoTaskMemFree(wfx);
    }
    ac->Release();
    return rate;
}

} // anon namespace

// ── SPSC Ring Buffer (lock-free single-producer / single-consumer) ───────────

class SpscRingBuffer {
    std::vector<float>    m_buf;
    std::atomic<uint32_t> m_write{0};
    std::atomic<uint32_t> m_read{0};
    uint32_t              m_cap;
    uint32_t              m_mask;

    static uint32_t next_pow2(uint32_t v) {
        v--; v |= v >> 1; v |= v >> 2; v |= v >> 4;
        v |= v >> 8; v |= v >> 16; return v + 1;
    }

public:
    explicit SpscRingBuffer(uint32_t min_cap)
        : m_cap(next_pow2(min_cap < 64 ? 64 : min_cap))
        , m_mask(m_cap - 1)
    {
        m_buf.resize(m_cap, 0.0f);
    }

    uint32_t write(const float* data, uint32_t count)
    {
        uint32_t w = m_write.load(std::memory_order_relaxed);
        uint32_t r = m_read.load(std::memory_order_acquire);
        uint32_t avail = m_cap - (w - r);
        uint32_t n = count < avail ? count : avail;
        for (uint32_t i = 0; i < n; ++i)
            m_buf[(w + i) & m_mask] = data[i];
        m_write.store(w + n, std::memory_order_release);
        return n;
    }

    uint32_t read(float* data, uint32_t count)
    {
        uint32_t r = m_read.load(std::memory_order_relaxed);
        uint32_t w = m_write.load(std::memory_order_acquire);
        uint32_t avail = w - r;
        uint32_t n = count < avail ? count : avail;
        for (uint32_t i = 0; i < n; ++i)
            data[i] = m_buf[(r + i) & m_mask];
        m_read.store(r + n, std::memory_order_release);
        return n;
    }
};

// ── WASAPIImpl (A1.2.2 — exclusive event-driven render loop) ─────────────────

struct WASAPIImpl {
    IMMDevice*           device        = nullptr;
    IAudioClient*        audio_client  = nullptr;
    IAudioRenderClient*  render_client = nullptr;
    HANDLE               buffer_event  = nullptr;
    HANDLE               stop_event    = nullptr;
    UINT32               buffer_frames = 0;
    int                  channels      = 0;
    uint32_t             sample_rate   = 0;
    bool                 com_init      = false;
    std::thread          render_thread;
    std::unique_ptr<SpscRingBuffer> ring;
    std::atomic<bool>    running{false};

    ~WASAPIImpl() { close(); }

    IMMDevice* find_device(const char* device_id)
    {
        IMMDeviceEnumerator* enumerator = nullptr;
        HRESULT hr = CoCreateInstance(kCLSID_MMDevEnum, nullptr, CLSCTX_ALL,
                                      kIID_IMMDevEnum,
                                      reinterpret_cast<void**>(&enumerator));
        if (FAILED(hr) || !enumerator) return nullptr;

        IMMDevice* dev = nullptr;
        if (!device_id || !*device_id || std::strcmp(device_id, "default") == 0) {
            enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &dev);
        } else {
            std::wstring wid = utf8_to_wstr(device_id);
            if (!wid.empty())
                enumerator->GetDevice(wid.c_str(), &dev);
        }
        enumerator->Release();
        return dev;
    }

    int open(const char* device_id, uint32_t rate, int ch)
    {
        close();

        HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        com_init = SUCCEEDED(hr);
        if (FAILED(hr) && hr != S_FALSE) return -1;

        device = find_device(device_id);
        if (!device) return -1;

        hr = device->Activate(kIID_IAudioClient, CLSCTX_ALL,
                              nullptr, reinterpret_cast<void**>(&audio_client));
        if (FAILED(hr) || !audio_client) return -1;

        // Build WAVEFORMATEXTENSIBLE — 32-bit float
        WAVEFORMATEXTENSIBLE wfx = {};
        wfx.Format.wFormatTag      = WAVE_FORMAT_EXTENSIBLE;
        wfx.Format.nChannels       = static_cast<WORD>(ch);
        wfx.Format.nSamplesPerSec  = rate;
        wfx.Format.wBitsPerSample  = 32;
        wfx.Format.nBlockAlign     = static_cast<WORD>(ch * 4);
        wfx.Format.nAvgBytesPerSec = rate * static_cast<DWORD>(ch) * 4;
        wfx.Format.cbSize          = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
        wfx.Samples.wValidBitsPerSample = 32;
        wfx.dwChannelMask = (ch == 1) ? SPEAKER_FRONT_CENTER
                          : (ch >= 2) ? (SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT)
                          : 0;
        wfx.SubFormat = kKSDATA_Float;

        // Get device period
        REFERENCE_TIME defaultPeriod = 0, minPeriod = 0;
        audio_client->GetDevicePeriod(&defaultPeriod, &minPeriod);
        if (defaultPeriod == 0) defaultPeriod = 100000; // 10 ms fallback

        // Initialize exclusive event-driven
        hr = audio_client->Initialize(
            AUDCLNT_SHAREMODE_EXCLUSIVE,
            AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
            defaultPeriod, defaultPeriod,
            reinterpret_cast<WAVEFORMATEX*>(&wfx), nullptr);

        // Handle buffer-size alignment requirement
        if (hr == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED) {
            audio_client->GetBufferSize(&buffer_frames);
            audio_client->Release();
            audio_client = nullptr;

            hr = device->Activate(kIID_IAudioClient, CLSCTX_ALL,
                                  nullptr, reinterpret_cast<void**>(&audio_client));
            if (FAILED(hr) || !audio_client) return -1;

            REFERENCE_TIME aligned = static_cast<REFERENCE_TIME>(
                10000000.0 * buffer_frames / rate + 0.5);
            hr = audio_client->Initialize(
                AUDCLNT_SHAREMODE_EXCLUSIVE,
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                aligned, aligned,
                reinterpret_cast<WAVEFORMATEX*>(&wfx), nullptr);
        }
        if (FAILED(hr)) return -1;

        hr = audio_client->GetBufferSize(&buffer_frames);
        if (FAILED(hr)) return -1;

        buffer_event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        stop_event   = CreateEventW(nullptr, TRUE,  FALSE, nullptr);
        if (!buffer_event || !stop_event) return -1;

        hr = audio_client->SetEventHandle(buffer_event);
        if (FAILED(hr)) return -1;

        hr = audio_client->GetService(kIID_IAudioRenderClient,
                                      reinterpret_cast<void**>(&render_client));
        if (FAILED(hr) || !render_client) return -1;

        channels    = ch;
        sample_rate = rate;

        // Ring buffer: 8 periods of interleaved float samples
        ring = std::make_unique<SpscRingBuffer>(buffer_frames * ch * 8);

        // Pre-fill first buffer with silence
        BYTE* data = nullptr;
        hr = render_client->GetBuffer(buffer_frames, &data);
        if (SUCCEEDED(hr))
            render_client->ReleaseBuffer(buffer_frames, AUDCLNT_BUFFERFLAGS_SILENT);

        hr = audio_client->Start();
        if (FAILED(hr)) return -1;

        running.store(true);
        render_thread = std::thread(&WASAPIImpl::render_loop, this);
        return 0;
    }

    int write(const float* buf, int frames)
    {
        if (!ring || !running.load()) return -1;
        uint32_t total = static_cast<uint32_t>(frames) * channels;
        uint32_t written = 0;
        while (written < total && running.load()) {
            uint32_t n = ring->write(buf + written, total - written);
            written += n;
            if (written < total)
                std::this_thread::sleep_for(std::chrono::microseconds(500));
        }
        return frames;
    }

    void render_loop()
    {
        CoInitializeEx(nullptr, COINIT_MULTITHREADED);

        DWORD taskIndex = 0;
        HANDLE task = AvSetMmThreadCharacteristicsW(L"Pro Audio", &taskIndex);

        HANDLE events[2] = {stop_event, buffer_event};
        const uint32_t frame_floats = buffer_frames * static_cast<uint32_t>(channels);

        while (running.load(std::memory_order_relaxed)) {
            DWORD wait = WaitForMultipleObjects(2, events, FALSE, 2000);
            if (wait == WAIT_OBJECT_0) break;           // stop signaled
            if (wait != WAIT_OBJECT_0 + 1) continue;    // timeout / error

            BYTE* data = nullptr;
            HRESULT hr = render_client->GetBuffer(buffer_frames, &data);
            if (FAILED(hr)) continue;

            uint32_t got = ring->read(reinterpret_cast<float*>(data), frame_floats);
            if (got < frame_floats)
                std::memset(reinterpret_cast<float*>(data) + got, 0,
                            (frame_floats - got) * sizeof(float));

            DWORD flags = (got == 0) ? AUDCLNT_BUFFERFLAGS_SILENT : 0;
            render_client->ReleaseBuffer(buffer_frames, flags);
        }

        if (task) AvRevertMmThreadCharacteristics(task);
        CoUninitialize();
    }

    void close()
    {
        running.store(false);
        if (stop_event) SetEvent(stop_event);
        if (render_thread.joinable()) render_thread.join();

        if (audio_client) audio_client->Stop();
        if (render_client) { render_client->Release(); render_client = nullptr; }
        if (audio_client)  { audio_client->Release();  audio_client  = nullptr; }
        if (device)        { device->Release();        device        = nullptr; }
        if (buffer_event)  { CloseHandle(buffer_event); buffer_event  = nullptr; }
        if (stop_event)    { CloseHandle(stop_event);   stop_event    = nullptr; }

        ring.reset();
        buffer_frames = 0;
        channels = 0;
        sample_rate = 0;

        if (com_init) { CoUninitialize(); com_init = false; }
    }
};

// ── A1.2.1  IMMDeviceEnumerator endpoint enumeration ─────────────────────────

std::vector<WasapiDeviceInfo> WASAPIOutput::enumerate_devices()
{
    std::vector<WasapiDeviceInfo> result;
    ComInit com;
    if (!com.ok()) return result;

    // Create the device enumerator
    IMMDeviceEnumerator* enumerator = nullptr;
    HRESULT hr = CoCreateInstance(kCLSID_MMDevEnum, nullptr, CLSCTX_ALL,
                                  kIID_IMMDevEnum,
                                  reinterpret_cast<void**>(&enumerator));
    if (FAILED(hr) || !enumerator) return result;

    // Get the default render endpoint ID for comparison
    std::string default_id;
    {
        IMMDevice* def = nullptr;
        if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &def)) && def) {
            default_id = device_id_utf8(def);
            def->Release();
        }
    }

    // Enumerate all active render endpoints
    IMMDeviceCollection* collection = nullptr;
    hr = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &collection);
    if (FAILED(hr) || !collection) {
        enumerator->Release();
        return result;
    }

    UINT count = 0;
    collection->GetCount(&count);

    for (UINT i = 0; i < count; ++i) {
        IMMDevice* dev = nullptr;
        if (FAILED(collection->Item(i, &dev)) || !dev) continue;

        WasapiDeviceInfo info;
        info.id                = device_id_utf8(dev);
        info.name              = device_name_utf8(dev);
        info.max_sample_rate   = device_sample_rate(dev);
        info.supports_exclusive = true;   // every WASAPI endpoint supports the attempt
        info.is_default        = (info.id == default_id);

        dev->Release();

        if (!info.id.empty())
            result.push_back(std::move(info));
    }

    collection->Release();
    enumerator->Release();
    return result;
}

// ── Public API (A1.2.2) ──────────────────────────────────────────────────────

WASAPIOutput::WASAPIOutput()  = default;
WASAPIOutput::~WASAPIOutput() { close(); }

int WASAPIOutput::open(const char* device_id, uint32_t sample_rate, int channels)
{
    close();
    m_impl = std::make_unique<WASAPIImpl>();
    return m_impl->open(device_id, sample_rate, channels);
}

int WASAPIOutput::write(const float* buf, int frames)
{
    return m_impl ? m_impl->write(buf, frames) : -1;
}

void WASAPIOutput::close()
{
    if (m_impl) {
        m_impl->close();
        m_impl.reset();
    }
}
