#[=======================================================================[.rst:
FindFFmpeg
----------

Find FFmpeg libraries (libavformat, libavcodec, libavutil, libswresample).

Tries pkg-config first (Linux / macOS / MSYS2), then falls back to
manual header + library search for environments without pkg-config
(vanilla Windows with pre-built FFmpeg binaries).

Imported targets
^^^^^^^^^^^^^^^^

``FFmpeg::avformat``
``FFmpeg::avcodec``
``FFmpeg::avutil``
``FFmpeg::swresample``

Result variables
^^^^^^^^^^^^^^^^

``FFmpeg_FOUND``          – TRUE if all requested components were found
``FFmpeg_INCLUDE_DIRS``   – combined include directories
``FFmpeg_LIBRARIES``      – combined link libraries

Hints
^^^^^

Set ``FFMPEG_ROOT`` (env or CMake variable) to a prefix that contains
``include/libavformat/avformat.h`` and ``lib/avformat.lib`` (or .so/.dylib).
#]=======================================================================]

include(FindPackageHandleStandardArgs)

# ── Components we need ─────────────────────────────────────────────────────
set(_ffmpeg_components avformat avcodec avutil swresample)

# ── 1. Try pkg-config ──────────────────────────────────────────────────────
find_package(PkgConfig QUIET)
set(_ffmpeg_all_found TRUE)

if(PkgConfig_FOUND)
    foreach(_comp IN LISTS _ffmpeg_components)
        pkg_check_modules(_PC_${_comp} QUIET lib${_comp})
        if(_PC_${_comp}_FOUND)
            set(FFmpeg_${_comp}_INCLUDE_DIR "${_PC_${_comp}_INCLUDE_DIRS}")
            set(FFmpeg_${_comp}_LIBRARY     "${_PC_${_comp}_LINK_LIBRARIES}")
            set(FFmpeg_${_comp}_FOUND TRUE)
        else()
            set(_ffmpeg_all_found FALSE)
        endif()
    endforeach()
endif()

# ── 2. Manual search fallback ──────────────────────────────────────────────
if(NOT _ffmpeg_all_found)
    # Gather search hints
    set(_ffmpeg_hints "")
    if(DEFINED FFMPEG_ROOT)
        list(APPEND _ffmpeg_hints "${FFMPEG_ROOT}")
    endif()
    if(DEFINED ENV{FFMPEG_ROOT})
        list(APPEND _ffmpeg_hints "$ENV{FFMPEG_ROOT}")
    endif()

    foreach(_comp IN LISTS _ffmpeg_components)
        if(NOT FFmpeg_${_comp}_FOUND)
            # Header
            find_path(FFmpeg_${_comp}_INCLUDE_DIR
                NAMES "lib${_comp}/${_comp}.h"
                      "lib${_comp}/version.h"
                HINTS ${_ffmpeg_hints}
                PATH_SUFFIXES include
            )

            # Library (static or shared)
            find_library(FFmpeg_${_comp}_LIBRARY
                NAMES ${_comp} lib${_comp}
                HINTS ${_ffmpeg_hints}
                PATH_SUFFIXES lib lib64 bin
            )

            if(FFmpeg_${_comp}_INCLUDE_DIR AND FFmpeg_${_comp}_LIBRARY)
                set(FFmpeg_${_comp}_FOUND TRUE)
            endif()
        endif()
    endforeach()
endif()

# ── 3. Aggregate results ──────────────────────────────────────────────────
set(FFmpeg_INCLUDE_DIRS "")
set(FFmpeg_LIBRARIES "")

foreach(_comp IN LISTS _ffmpeg_components)
    if(FFmpeg_${_comp}_FOUND)
        list(APPEND FFmpeg_INCLUDE_DIRS ${FFmpeg_${_comp}_INCLUDE_DIR})
        list(APPEND FFmpeg_LIBRARIES    ${FFmpeg_${_comp}_LIBRARY})

        if(NOT TARGET FFmpeg::${_comp})
            add_library(FFmpeg::${_comp} UNKNOWN IMPORTED)
            set_target_properties(FFmpeg::${_comp} PROPERTIES
                IMPORTED_LOCATION             "${FFmpeg_${_comp}_LIBRARY}"
                INTERFACE_INCLUDE_DIRECTORIES "${FFmpeg_${_comp}_INCLUDE_DIR}"
            )
        endif()
    endif()
endforeach()

list(REMOVE_DUPLICATES FFmpeg_INCLUDE_DIRS)
list(REMOVE_DUPLICATES FFmpeg_LIBRARIES)

find_package_handle_standard_args(FFmpeg
    REQUIRED_VARS FFmpeg_LIBRARIES FFmpeg_INCLUDE_DIRS
    HANDLE_COMPONENTS
)
