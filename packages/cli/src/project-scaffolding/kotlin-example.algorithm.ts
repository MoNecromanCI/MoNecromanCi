import {
  GRADLE_DEPENDENCIES_BEGIN,
  GRADLE_DEPENDENCIES_END,
  GRADLE_PROJECTS_BEGIN,
  GRADLE_PROJECTS_END,
  KOTLIN_JVM_TOOLCHAIN,
  KOTLIN_VERSION,
  KTLINT_PLUGIN_VERSION,
} from './kotlin-build.config'
import { javaPackageSegment } from './java-example.algorithm'

/**
 * The three Kotlin project kinds.
 *
 * @remarks
 * They differ in where they live and whether they build an executable distribution.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type KotlinKind = 'kotlin-app' | 'kotlin-lib' | 'kotlin-internal-lib'

/**
 * The project entries of the root `settings.gradle.kts`, as the lines mnci writes for one project.
 *
 * @param name - The project name, which is also its Gradle path (`:<name>`).
 * @param directory - The project's workspace-relative directory.
 * @returns The two lines that include the project and point it at its directory.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function projectLines (name: string, directory: string): string[] {
  return [`include(":${name}")`, `project(":${name}").projectDir = file("${directory}")`]
}

/**
 * The root `settings.gradle.kts`: the repository every project resolves from and one include per project.
 *
 * @remarks
 * Gradle has no workspace file of its own, so this is both the reactor and, with `libs.versions.toml`, the one place a
 * project is declared. Projects keep their own directories (`apps/<name>`) through `projectDir`, so a task path is
 * `:<name>:test` and not `:apps:<name>:test`. It is mnci's, as `go.work` and the root `pom.xml` are.
 *
 * @param name - The first project's name.
 * @param directory - The first project's directory.
 * @returns The text of `settings.gradle.kts`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function gradleSettings (name: string, directory: string): string {
  return `// Written by MoNecromanCI. mnci adds an include per project between the markers; the rest is yours.
rootProject.name = "workspace"

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}

${GRADLE_PROJECTS_BEGIN}
${projectLines(name, directory).join('\n')}
${GRADLE_PROJECTS_END}
`
}

/**
 * Adds a project to an existing `settings.gradle.kts`.
 *
 * @remarks
 * The lines go before the end marker. A file with no marker (one the team rewrote) is returned unchanged by design: the
 * caller reports that, instead of mnci guessing where an include belongs. Idempotent.
 *
 * @param text - The text of the settings file.
 * @param name - The project name.
 * @param directory - The project's workspace-relative directory.
 * @returns The text with the project included.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function addGradleProject (text: string, name: string, directory: string): string {
  const [include] = projectLines(name, directory)
  if (text.includes(include) || !text.includes(GRADLE_PROJECTS_END)) {
    return text
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'

  return text.replace(GRADLE_PROJECTS_END, () => `${projectLines(name, directory).join(newline)}${newline}${GRADLE_PROJECTS_END}`)
}

/**
 * The version catalog: Kotlin and ktlint, and every library mnci adds later.
 *
 * @remarks
 * `gradle/libs.versions.toml` is Gradle's declarative surface (a `build.gradle.kts` is a program), and so the file
 * `mnci install` edits. A library is one `[libraries]` entry and a use of `libs.<alias>` in a project's dependency block.
 *
 * @param None - this function takes no parameters.
 * @returns The text of the catalog.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function gradleCatalog (): string {
  return `[versions]
kotlin = "${KOTLIN_VERSION}"
ktlint-plugin = "${KTLINT_PLUGIN_VERSION}"

[libraries]
kotlin-test = { module = "org.jetbrains.kotlin:kotlin-test", version.ref = "kotlin" }

[plugins]
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }
ktlint = { id = "org.jlleitschuh.gradle.ktlint", version.ref = "ktlint-plugin" }
`
}

/**
 * A project's `build.gradle.kts`.
 *
 * @remarks
 * The shape is fixed because mnci edits it: the plugins come from the catalog, the build directory moves to
 * `dist/gradle/<name>` (nothing lands beside the sources, and Nx clears a target's outputs on a cache restore), and the
 * project's own dependencies sit between two marker comments, which is the only part `mnci install` writes. An app is the
 * `application` plugin with its entry point and a distribution zip named for the kind, written into `dist/drop`.
 *
 * @param kind - Which Kotlin kind.
 * @param group - The Maven group, which is also the base of the package.
 * @param name - The project name.
 * @returns The text of `build.gradle.kts`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function kotlinBuildFile (kind: KotlinKind, group: string, name: string): string {
  const app = kind === 'kotlin-app'
  const application = app
    ? `
application {
    mainClass = "${group}.${javaPackageSegment(name)}.MainKt"
}

tasks.distZip {
    archiveFileName = "kotlin-app-${name}.zip"
    destinationDirectory = rootProject.layout.projectDirectory.dir("dist/drop")
}
`
    : ''

  return `plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.ktlint)${app ? '\n    application' : ''}
}

group = "${group}"
version = "0.1.0"

layout.buildDirectory = rootProject.layout.projectDirectory.dir("dist/gradle/${name}")

kotlin {
    jvmToolchain(${KOTLIN_JVM_TOOLCHAIN})
}

dependencies {
    ${GRADLE_DEPENDENCIES_BEGIN}
    ${GRADLE_DEPENDENCIES_END}
    testImplementation(libs.kotlin.test)
}

tasks.test {
    useJUnitPlatform()
}
${application}`
}

/**
 * The files of the worked example, as paths relative to the project to contents.
 *
 * @remarks
 * A package slice with the role in the type name, as the Java kinds have: `<group>.<name>.greeting` holds a
 * `GreetingContract` and a `GreetUseCase`, with a test beside them in the same package under `src/test`, and an app's
 * `Main.kt` only wires. ktlint's official style wants a data class one property per line with a trailing comma.
 *
 * @param kind - Which Kotlin kind.
 * @param group - The Maven group.
 * @param name - The project name.
 * @returns The files to write.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function kotlinExampleFiles (kind: KotlinKind, group: string, name: string): Record<string, string> {
  const base = `${group}.${javaPackageSegment(name)}`
  const path = base.replaceAll('.', '/')
  const files: Record<string, string> = {
    [`src/main/kotlin/${path}/greeting/GreetingContract.kt`]: `package ${base}.greeting

/** What greeting someone returns. */
data class GreetingContract(
    val message: String,
)
`,
    [`src/main/kotlin/${path}/greeting/GreetUseCase.kt`]: `package ${base}.greeting

/** Greets a name; a blank one is greeted as a stranger. */
object GreetUseCase {
    fun greet(name: String): GreetingContract {
        val who = name.trim().ifEmpty { "stranger" }

        return GreetingContract("Hello, $who!")
    }
}
`,
    [`src/test/kotlin/${path}/greeting/GreetUseCaseTest.kt`]: `package ${base}.greeting

import kotlin.test.Test
import kotlin.test.assertEquals

class GreetUseCaseTest {
    @Test
    fun greetsAName() {
        assertEquals("Hello, Ada!", GreetUseCase.greet("Ada").message)
    }

    @Test
    fun greetsABlankNameAsAStranger() {
        assertEquals("Hello, stranger!", GreetUseCase.greet("   ").message)
    }
}
`,
  }
  if (kind === 'kotlin-app') {
    files[`src/main/kotlin/${path}/Main.kt`] = `package ${base}

import ${base}.greeting.GreetUseCase

fun main() {
    println(GreetUseCase.greet("world").message)
}
`
  }

  return files
}

/**
 * The files of a bare project (`--empty`): the smallest source that still builds and tests.
 *
 * @remarks
 * An app keeps `Main.kt` alone. A library keeps no source at all: Gradle reports an empty source set as `NO-SOURCE` and
 * still builds the jar, and a file with nothing but a package line is what ktlint's `no-empty-file` rejects.
 *
 * @param kind - Which Kotlin kind.
 * @param group - The Maven group.
 * @param name - The project name.
 * @returns The files to write.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function kotlinEmptyFiles (kind: KotlinKind, group: string, name: string): Record<string, string> {
  if (kind !== 'kotlin-app') {
    return {}
  }
  const base = `${group}.${javaPackageSegment(name)}`

  return {
    [`src/main/kotlin/${base.replaceAll('.', '/')}/Main.kt`]: `package ${base}

fun main() {
    // The application starts here.
}
`,
  }
}
