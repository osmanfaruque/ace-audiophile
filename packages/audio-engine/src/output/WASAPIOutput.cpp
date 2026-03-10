// ── A1.2  WASAPI output backend ──────────────────────────────────────────────
//
// A1.2.1 — IMMDeviceEnumerator endpoint enumeration
// A1.2.2+ (event-driven render loop, format negotiation, etc.) — TODO
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
#include <propsys.h>
#include <propvarutil.h>

#include <cstring>
#include <string>

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

// ── Stub lifecycle (filled in A1.2.2+) ───────────────────────────────────────

WASAPIOutput::WASAPIOutput()  = default;
WASAPIOutput::~WASAPIOutput() = default;

int  WASAPIOutput::open(const char*, uint32_t, int) { return 0; }
int  WASAPIOutput::write(const float*, int frames)  { return frames; }
void WASAPIOutput::close() {}
