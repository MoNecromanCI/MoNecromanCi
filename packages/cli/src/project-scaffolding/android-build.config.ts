/**
 * The Android Gradle Plugin version every Android project builds with.
 *
 * @remarks
 * AGP and Gradle are coupled, so this is the one place the pair is decided. AGP 9.4 needs Gradle 9.6.0 or newer and a JDK
 * 17 or newer, ships its own Kotlin support (no `org.jetbrains.kotlin.android` plugin), and supports up to API level 37.
 * Measured with 9.4.1 on Gradle 9.8.1 and JDK 21.
 */
export const AGP_VERSION = '9.4.1'

/**
 * The oldest Gradle the pinned {@link AGP_VERSION} runs on.
 *
 * @remarks
 * Gradle 9.6.0 for AGP 9.4 (the compatibility table of the Android Gradle Plugin release notes). `mnci add` compares it
 * with `gradle --version` and says so, because AGP's own message names the requirement only after the configure phase.
 */
export const AGP_MIN_GRADLE = '9.6.0'

/**
 * The platform every Android project compiles against.
 *
 * @remarks
 * Compose BOM 2026.09 and the AndroidX libraries it brings require `compileSdk` 37, so the example and the platform move
 * together. `platforms;android-37.0` is the `sdkmanager` package that provides it.
 */
export const ANDROID_COMPILE_SDK = 37

/**
 * The oldest Android version the example runs on.
 *
 * @remarks
 * API 26 (Android 8.0), which Compose and Material 3 support; a team that must reach older devices edits one line.
 */
export const ANDROID_MIN_SDK = 26

/**
 * The SDK Build Tools AGP 9.4 needs, as an `sdkmanager` package.
 *
 * @remarks
 * AGP picks its own default build tools version (36.0.0 for 9.4) and fails when it is not installed, so the warning
 * `mnci add` prints names the exact package.
 */
export const ANDROID_BUILD_TOOLS_PACKAGE = 'build-tools;36.0.0'

/**
 * The `sdkmanager` package of the platform {@link ANDROID_COMPILE_SDK} names.
 *
 * @remarks
 * Kept beside the number it derives from, because the platform folder is `android-37.0`, not `android-37`.
 */
export const ANDROID_PLATFORM_PACKAGE = 'platforms;android-37.0'

/**
 * The Compose BOM: one version that fixes every `androidx.compose.*` library.
 *
 * @remarks
 * Written into the version catalog; the individual Compose libraries are declared without a version and take it from the
 * BOM, which is how Google documents it.
 */
export const COMPOSE_BOM_VERSION = '2026.09.00'

/**
 * The `androidx.activity:activity-compose` version, which hosts a Compose UI in an activity.
 *
 * @remarks
 * Not covered by the BOM, so it is pinned beside it.
 */
export const ACTIVITY_COMPOSE_VERSION = '1.13.0'

/**
 * The JUnit 4 version Android's local unit tests run on.
 *
 * @remarks
 * The Android unit-test runner is JUnit 4; the Kotlin kinds' JUnit Platform setup does not apply.
 */
export const JUNIT4_VERSION = '4.13.2'
