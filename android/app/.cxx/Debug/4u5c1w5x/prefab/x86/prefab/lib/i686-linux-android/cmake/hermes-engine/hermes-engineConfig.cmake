if(NOT TARGET hermes-engine::libhermes)
add_library(hermes-engine::libhermes SHARED IMPORTED)
set_target_properties(hermes-engine::libhermes PROPERTIES
    IMPORTED_LOCATION "C:/Users/HP/.gradle/caches/8.14.1/transforms/0564884bb1469621e10cacb85344fb6d/transformed/hermes-android-0.80.0-debug/prefab/modules/libhermes/libs/android.x86/libhermes.so"
    INTERFACE_INCLUDE_DIRECTORIES "C:/Users/HP/.gradle/caches/8.14.1/transforms/0564884bb1469621e10cacb85344fb6d/transformed/hermes-android-0.80.0-debug/prefab/modules/libhermes/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

