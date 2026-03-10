cmake_minimum_required(VERSION 3.22)
project(ace_engine VERSION 0.1.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ── Custom CMake modules ──────────────────────────────────────────────────────
list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

# ── FFmpeg detection (A1.1.1) ─────────────────────────────────────────────────
#
# Priority:
#   1. System FFmpeg via FindFFmpeg (pkg-config or manual search)
#   2. FFMPEG_ROOT hint  (e.g.  -DFFMPEG_ROOT=C:/ffmpeg)
#   3. FetchContent: download pre-built FFmpeg shared libs
#
find_package(FFmpeg QUIET)

if(NOT FFmpeg_FOUND)
    message(STATUS "[ace] System FFmpeg not found – using FetchContent pre-built binaries")
    include(FetchContent)

    if(WIN32)
        # BtbN GPL shared build (Windows x86_64)
        set(_FFMPEG_URL
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-win64-gpl-shared-7.1.zip")
        set(_FFMPEG_HASH "")  # populated after first download; CMake will still work without it
    else()
        message(FATAL_ERROR
            "[ace] No system FFmpeg found and FetchContent pre-built is only automated for Windows. "
            "Install FFmpeg dev packages or set -DFFMPEG_ROOT=<path>.")
    endif()

    FetchContent_Declare(ffmpeg_prebuilt
        URL      "${_FFMPEG_URL}"
        URL_HASH "${_FFMPEG_HASH}"
    )
    FetchContent_MakeAvailable(ffmpeg_prebuilt)

    # Point FFMPEG_ROOT at the fetched tree so FindFFmpeg picks it up.
    set(FFMPEG_ROOT "${ffmpeg_prebuilt_SOURCE_DIR}" CACHE PATH "" FORCE)
    find_package(FFmpeg REQUIRED)
endif()

message(STATUS "[ace] FFmpeg include dirs: ${FFmpeg_INCLUDE_DIRS}")
message(STATUS "[ace] FFmpeg libraries:    ${FFmpeg_LIBRARIES}")

# ── KissFFT (A1.4.4) ─────────────────────────────────────────────────────────
include(FetchContent)
FetchContent_Declare(kissfft
    GIT_REPOSITORY https://github.com/mborgerding/kissfft.git
    GIT_TAG        131.1.0
    CONFIGURE_COMMAND ""
    BUILD_COMMAND     ""
    INSTALL_COMMAND   ""
)
FetchContent_Populate(kissfft)
message(STATUS "[ace] KissFFT source dir: ${kissfft_SOURCE_DIR}")

# ── Source files ──────────────────────────────────────────────────────────────
set(ACE_SOURCES
    src/AudioEngine.cpp
    src/decoder/FFmpegDecoder.cpp
    src/dsp/DspChain.cpp
    src/dsp/PEQ.cpp
    src/dsp/Crossfeed.cpp
    src/dsp/Dither.cpp
    src/dsp/Resampler.cpp
    src/analysis/Spectrogram.cpp
    src/analysis/BitDepthAnalyzer.cpp
    src/analysis/LossyDetector.cpp
    src/analysis/DynamicRange.cpp
    src/output/AudioOutput.cpp
)

# ── Shared library (loaded by Tauri Rust bridge via FFI) ──────────────────────
add_library(ace_engine SHARED ${ACE_SOURCES})
target_include_directories(ace_engine PUBLIC include)
target_include_directories(ace_engine PRIVATE src)

# KissFFT — compile kiss_fft.c directly (header-only style with one .c file)
target_sources(ace_engine PRIVATE "${kissfft_SOURCE_DIR}/kiss_fft.c")
target_include_directories(ace_engine PRIVATE "${kissfft_SOURCE_DIR}")

# Link FFmpeg (avformat, avcodec, avutil, swresample)
target_link_libraries(ace_engine PRIVATE
    FFmpeg::avformat
    FFmpeg::avcodec
    FFmpeg::avutil
    FFmpeg::swresample
)

# ── Platform-specific output backends ─────────────────────────────────────────
if(WIN32)
    target_sources(ace_engine PRIVATE src/output/WASAPIOutput.cpp)
    target_link_libraries(ace_engine PRIVATE mmdevapi ole32 avrt)
elseif(APPLE)
    target_sources(ace_engine PRIVATE src/output/CoreAudioOutput.cpp)
    target_link_libraries(ace_engine PRIVATE
        "-framework CoreAudio"
        "-framework AudioUnit"
        "-framework CoreServices"
    )
elseif(ANDROID)
    target_sources(ace_engine PRIVATE src/output/OboeOutput.cpp)
    # Oboe is fetched via FetchContent in production; stub omitted here
elseif(UNIX)
    target_sources(ace_engine PRIVATE src/output/ALSAOutput.cpp)
    target_link_libraries(ace_engine PRIVATE asound)
endif()

# ── Optional: build CLI test harness ─────────────────────────────────────────
option(ACE_BUILD_CLI "Build command-line test harness" OFF)
if(ACE_BUILD_CLI)
    add_executable(ace_cli test/cli_main.cpp)
    target_link_libraries(ace_cli PRIVATE ace_engine)
endif()
