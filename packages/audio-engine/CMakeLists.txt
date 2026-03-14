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

# ── libsoxr (A1.3.4 — polyphase resampler) ───────────────────────────────────
set(BUILD_TESTS    OFF CACHE BOOL "" FORCE)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WITH_OPENMP    OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF)
set(CMAKE_POLICY_VERSION_MINIMUM 3.5 CACHE STRING "" FORCE)
FetchContent_Declare(soxr
    GIT_REPOSITORY https://github.com/chirlu/soxr.git
    GIT_TAG        0.1.3
    CONFIGURE_COMMAND ""
    BUILD_COMMAND     ""
    INSTALL_COMMAND   ""
)
FetchContent_Populate(soxr)
# soxr's CMakeLists uses CMAKE_SOURCE_DIR for its cmake modules path, which
# resolves to our project root when built as a subdirectory.  Pre-set the
# correct path so include(SetSystemProcessor) etc. succeed.
list(APPEND CMAKE_MODULE_PATH "${soxr_SOURCE_DIR}/cmake/Modules")
add_subdirectory(${soxr_SOURCE_DIR} ${soxr_BINARY_DIR} EXCLUDE_FROM_ALL)
unset(CMAKE_POLICY_VERSION_MINIMUM CACHE)
message(STATUS "[ace] libsoxr source dir: ${soxr_SOURCE_DIR}")

# ── TagLib (A4.2 metadata extraction) ───────────────────────────────────────
find_package(TagLib QUIET)
if(NOT TagLib_FOUND)
    message(STATUS "[ace] System TagLib not found – fetching TagLib from source")
    set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
    set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    FetchContent_Declare(taglib
        GIT_REPOSITORY https://github.com/taglib/taglib.git
        GIT_TAG        v2.0.2
    )
    FetchContent_MakeAvailable(taglib)
endif()

# ── Source files ──────────────────────────────────────────────────────────────
set(ACE_SOURCES
    src/AudioEngine.cpp
    src/stream/StreamProtocol.cpp
    src/decoder/FFmpegDecoder.cpp
    src/dsp/DspChain.cpp
    src/dsp/PEQ.cpp
    src/dsp/PreAmp.cpp
    src/dsp/Crossfeed.cpp
    src/dsp/Spatializer.cpp
    src/dsp/ReplayGain.cpp
    src/dsp/Limiter.cpp
    src/dsp/Convolver.cpp
    src/dsp/ChannelMixer.cpp
    src/dsp/CrossfadeEngine.cpp
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
if(DEFINED taglib_SOURCE_DIR)
    target_include_directories(ace_engine PRIVATE
        "${taglib_SOURCE_DIR}/taglib"
        "${taglib_SOURCE_DIR}/taglib/toolkit"
        "${taglib_SOURCE_DIR}/taglib/flac"
        "${taglib_SOURCE_DIR}/taglib/mpeg"
        "${taglib_SOURCE_DIR}/taglib/mpeg/id3v2"
        "${taglib_SOURCE_DIR}/taglib/mpeg/id3v2/frames"
        "${taglib_SOURCE_DIR}/taglib/mp4"
        "${taglib_SOURCE_DIR}/taglib/ogg"
    )
endif()
if(TagLib_FOUND AND TagLib_INCLUDE_DIRS)
    target_include_directories(ace_engine PRIVATE ${TagLib_INCLUDE_DIRS})
endif()

# KissFFT — compile kiss_fft.c directly (header-only style with one .c file)
target_sources(ace_engine PRIVATE "${kissfft_SOURCE_DIR}/kiss_fft.c")
target_include_directories(ace_engine PRIVATE "${kissfft_SOURCE_DIR}")

# libsoxr include (soxr's old CMake doesn't propagate INTERFACE_INCLUDE_DIRECTORIES)
target_include_directories(ace_engine PRIVATE "${soxr_SOURCE_DIR}/src")

# Link FFmpeg (avformat, avcodec, avutil, swresample)
target_link_libraries(ace_engine PRIVATE
    FFmpeg::avformat
    FFmpeg::avcodec
    FFmpeg::avutil
    FFmpeg::swresample
    soxr
)

if(TARGET TagLib::TagLib)
    target_link_libraries(ace_engine PRIVATE TagLib::TagLib)
elseif(TARGET tag)
    target_link_libraries(ace_engine PRIVATE tag)
elseif(TARGET taglib)
    target_link_libraries(ace_engine PRIVATE taglib)
endif()

# TagLib is linked statically in our build graph; avoid __declspec(dllimport)
# symbols that would otherwise require a separate import library on Windows.
target_compile_definitions(ace_engine PRIVATE TAGLIB_STATIC TAGLIB_STATIC_DEFINE)

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

# ── Unit Tests (Google Test — A1.5) ──────────────────────────────────────────
option(ACE_BUILD_TESTS "Build Google Test unit tests" ON)
if(ACE_BUILD_TESTS)
    FetchContent_Declare(googletest
        GIT_REPOSITORY https://github.com/google/googletest.git
        GIT_TAG        v1.14.0
    )
    set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
    FetchContent_MakeAvailable(googletest)
    enable_testing()

    # A1.5.1 — Decoder FLAC hash test
    add_executable(test_decoder test/test_decoder.cpp)
    target_link_libraries(test_decoder PRIVATE
        ace_engine GTest::gtest GTest::gtest_main
        FFmpeg::avformat FFmpeg::avcodec FFmpeg::avutil FFmpeg::swresample
    )
    target_include_directories(test_decoder PRIVATE src include
        "${kissfft_SOURCE_DIR}" "${soxr_SOURCE_DIR}/src")
    add_test(NAME DecoderFlacHash COMMAND test_decoder)

    # A1.5.2 — PEQ sweep response test
    add_executable(test_peq test/test_peq.cpp src/dsp/PEQ.cpp)
    target_link_libraries(test_peq PRIVATE GTest::gtest GTest::gtest_main)
    target_include_directories(test_peq PRIVATE src include)
    add_test(NAME PeqSweepResponse COMMAND test_peq)

    # A1.5.3 — WASAPI exclusive mode test
    add_executable(test_wasapi test/test_wasapi.cpp)
    target_link_libraries(test_wasapi PRIVATE
        ace_engine GTest::gtest GTest::gtest_main
    )
    target_include_directories(test_wasapi PRIVATE src include)
    if(WIN32)
        target_link_libraries(test_wasapi PRIVATE mmdevapi ole32 avrt)
    endif()
    add_test(NAME WasapiExclusive COMMAND test_wasapi)
endif()
