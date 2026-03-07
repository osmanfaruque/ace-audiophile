cmake_minimum_required(VERSION 3.22)
project(ace_engine VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ── Source files ──────────────────────────────────────────────────────────────
set(ACE_SOURCES
    src/AudioEngine.cpp
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

# ── Platform-specific output backends ─────────────────────────────────────────
if(WIN32)
    target_sources(ace_engine PRIVATE src/output/WASAPIOutput.cpp)
    target_link_libraries(ace_engine PRIVATE mmdevapi ole32)
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
