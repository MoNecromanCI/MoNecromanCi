/**
 * The Kotlin Gradle plugin version every Kotlin project builds with.
 *
 * @remarks
 * The newest stable release at the time of writing (the plugin portal lists 2.5 betas, which are not used). It is written
 * into the version catalog, the one place a Kotlin version lives.
 */
export const KOTLIN_VERSION = '2.4.21'

/**
 * The ktlint Gradle plugin version `lint` runs.
 *
 * @remarks
 * `org.jlleitschuh.gradle.ktlint`, which wraps the ktlint engine and checks main and test sources with ktlint's official
 * code style. Measured: it flagged a one-line `data class` in the worked example, so the example is written to the style.
 */
export const KTLINT_PLUGIN_VERSION = '14.2.0'

/**
 * The JDK every Kotlin project compiles for (`kotlin { jvmToolchain(...) }`).
 *
 * @remarks
 * The same LTS as the Java kinds' `maven.compiler.release`. The JDK that runs Gradle must have this toolchain installed:
 * no toolchain resolver is configured, so a missing one fails with Gradle's own message instead of a download.
 */
export const KOTLIN_JVM_TOOLCHAIN = 21

/**
 * The workspace-relative path of the Gradle settings file mnci owns: one `include` per project.
 *
 * @remarks
 * The code that writes this and the code that reads it back share the constant, so the two cannot disagree.
 */
export const GRADLE_SETTINGS_PATH = 'settings.gradle.kts'

/**
 * The workspace-relative path of the version catalog: the declarative surface `mnci install` edits.
 *
 * @remarks
 * The code that writes this and the code that reads it back share the constant, so the two cannot disagree.
 */
export const GRADLE_CATALOG_PATH = 'gradle/libs.versions.toml'

/**
 * The workspace-relative path of the Gradle properties mnci writes once.
 *
 * @remarks
 * The code that writes this and the code that reads it back share the constant, so the two cannot disagree.
 */
export const GRADLE_PROPERTIES_PATH = 'gradle.properties'

/**
 * Marks the start of the lines of `settings.gradle.kts` that mnci writes for projects.
 *
 * @remarks
 * The code that writes this and the code that reads it back share the constant, so the two cannot disagree.
 */
export const GRADLE_PROJECTS_BEGIN = '// mnci:projects'

/**
 * Marks the end of the lines of `settings.gradle.kts` that mnci writes for projects.
 *
 * @remarks
 * The code that writes this and the code that reads it back share the constant, so the two cannot disagree.
 */
export const GRADLE_PROJECTS_END = '// mnci:projects-end'

/**
 * Marks the start of the dependency lines of a project's `build.gradle.kts` that mnci writes.
 *
 * @remarks
 * The code that writes this and the code that reads it back share the constant, so the two cannot disagree.
 */
export const GRADLE_DEPENDENCIES_BEGIN = '// mnci:dependencies'

/**
 * Marks the end of the dependency lines of a project's `build.gradle.kts` that mnci writes.
 *
 * @remarks
 * The code that writes this and the code that reads it back share the constant, so the two cannot disagree.
 */
export const GRADLE_DEPENDENCIES_END = '// mnci:dependencies-end'

/**
 * The `gradle.properties` written once beside `settings.gradle.kts`.
 *
 * @remarks
 * A bounded daemon heap, so several Nx tasks that start Gradle do not each take the machine's default. Yours from then
 * on: mnci never rewrites it.
 */
export const GRADLE_PROPERTIES = `# Written once by MoNecromanCI; yours from here.
org.gradle.jvmargs=-Xmx1g
kotlin.code.style=official
`
