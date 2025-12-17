if(NOT TARGET fbjni::fbjni)
add_library(fbjni::fbjni SHARED IMPORTED)
set_target_properties(fbjni::fbjni PROPERTIES
    IMPORTED_LOCATION "C:/Users/HP/.gradle/caches/8.14.1/transforms/03b490ef839d0af7b365b1b3a0df4a48/transformed/fbjni-0.7.0/prefab/modules/fbjni/libs/android.x86/libfbjni.so"
    INTERFACE_INCLUDE_DIRECTORIES "C:/Users/HP/.gradle/caches/8.14.1/transforms/03b490ef839d0af7b365b1b3a0df4a48/transformed/fbjni-0.7.0/prefab/modules/fbjni/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

