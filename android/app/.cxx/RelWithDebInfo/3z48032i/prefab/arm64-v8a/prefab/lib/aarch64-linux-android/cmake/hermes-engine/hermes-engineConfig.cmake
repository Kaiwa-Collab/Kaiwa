if(NOT TARGET hermes-engine::libhermes)
add_library(hermes-engine::libhermes SHARED IMPORTED)
set_target_properties(hermes-engine::libhermes PROPERTIES
    IMPORTED_LOCATION "C:/Users/HP/.gradle/caches/8.14.1/transforms/2843fa3a1f55b4872bd8d0cc69468715/transformed/hermes-android-0.80.0-release/prefab/modules/libhermes/libs/android.arm64-v8a/libhermes.so"
    INTERFACE_INCLUDE_DIRECTORIES "C:/Users/HP/.gradle/caches/8.14.1/transforms/2843fa3a1f55b4872bd8d0cc69468715/transformed/hermes-android-0.80.0-release/prefab/modules/libhermes/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

