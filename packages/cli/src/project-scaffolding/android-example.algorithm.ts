import {
  ACTIVITY_COMPOSE_VERSION,
  AGP_VERSION,
  ANDROID_COMPILE_SDK,
  ANDROID_MIN_SDK,
  COMPOSE_BOM_VERSION,
  JUNIT4_VERSION,
} from './android-build.config'
import { GRADLE_DEPENDENCIES_BEGIN, GRADLE_DEPENDENCIES_END } from './kotlin-build.config'
import { javaPackageSegment } from './java-example.algorithm'

/**
 * The three Android project kinds.
 *
 * @remarks
 * They differ in where they live and in what they build: an application is an APK, a library an AAR.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type AndroidKind = 'android-app' | 'android-lib' | 'android-internal-lib'

/**
 * The version, library and plugin entries an Android project needs in the version catalog.
 *
 * @remarks
 * Appended to a catalog that already holds the Kotlin entries (the Kotlin kinds write it first), never replacing one: a
 * key that is already there is left as the team has it. Each line is `key = value`, grouped by table.
 */
const ANDROID_CATALOG_ENTRIES: Readonly<Record<'versions' | 'libraries' | 'plugins', ReadonlyArray<readonly [string, string]>>> = {
  versions: [
    ['agp', `"${AGP_VERSION}"`],
    ['compose-bom', `"${COMPOSE_BOM_VERSION}"`],
    ['activity-compose', `"${ACTIVITY_COMPOSE_VERSION}"`],
    ['junit', `"${JUNIT4_VERSION}"`],
  ],
  libraries: [
    ['androidx-compose-bom', '{ module = "androidx.compose:compose-bom", version.ref = "compose-bom" }'],
    ['androidx-compose-material3', '{ module = "androidx.compose.material3:material3" }'],
    ['androidx-activity-compose', '{ module = "androidx.activity:activity-compose", version.ref = "activity-compose" }'],
    ['junit', '{ module = "junit:junit", version.ref = "junit" }'],
  ],
  plugins: [
    ['android-application', '{ id = "com.android.application", version.ref = "agp" }'],
    ['android-library', '{ id = "com.android.library", version.ref = "agp" }'],
    ['kotlin-compose', '{ id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }'],
  ],
}

/**
 * Adds the Android entries to a version catalog.
 *
 * @remarks
 * Idempotent and additive. A table the catalog lacks is created at the end; a key already declared (the team's own
 * `junit`, say) is kept as it is. The Kotlin version the Compose compiler plugin references is `kotlin`, which the
 * Kotlin kinds' catalog already has.
 *
 * @param text - The text of `gradle/libs.versions.toml`.
 * @returns The catalog with the entries.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function withAndroidCatalog (text: string): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  let lines = text.split(/\r?\n/)
  for (const [table, entries] of Object.entries(ANDROID_CATALOG_ENTRIES)) {
    const header = `[${table}]`
    let start = lines.findIndex(line => line.trim() === header)
    if (start === -1) {
      while (lines.length > 0 && lines.at(-1)?.trim() === '') {
        lines.pop()
      }
      lines.push('', header)
      start = lines.length - 1
    }
    let end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line))
    if (end === -1) {
      end = lines.length
    }
    while (end - 1 > start && lines[end - 1]?.trim() === '') {
      end--
    }
    const missing = entries
      .filter(([key]) => lines.slice(start + 1, end).every(line => !new RegExp(String.raw`^\s*${key}\s*=`).test(line)))
      .map(([key, value]) => `${key} = ${value}`)
    lines = [...lines.slice(0, end), ...missing, ...lines.slice(end)]
  }
  const joined = lines.join(newline)

  return joined.endsWith(newline) ? joined : `${joined}${newline}`
}

/**
 * Makes `settings.gradle.kts` resolve Android's plugin and libraries, which live on Google's Maven repository.
 *
 * @remarks
 * AGP is not on the Gradle plugin portal, so `pluginManagement` needs `google()`, and AndroidX libraries are not on Maven
 * Central, so the dependency repositories need it too. A settings file the Kotlin kinds wrote has neither. Idempotent; a
 * file whose repositories block cannot be recognised is returned unchanged and the caller says so.
 *
 * @param text - The text of the settings file.
 * @returns The text with Google's repository in both places.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function withGoogleRepository (text: string): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  let result = text
  if (!/^\s*pluginManagement\s*\{/m.test(result)) {
    const block = ['pluginManagement {', '    repositories {', '        google()', '        mavenCentral()', '        gradlePluginPortal()', '    }', '}', ''].join(newline)
    const rootName = /^\s*rootProject\.name\s*=.*$/m.exec(result)
    result = rootName === null
      ? `${block}${newline}${result}`
      : `${result.slice(0, rootName.index + rootName[0].length)}${newline}${newline}${block}${result.slice(rootName.index + rootName[0].length)}`
  }
  const resolution = /dependencyResolutionManagement\s*\{[\s\S]*?repositories\s*\{/.exec(result)
  if (resolution !== null) {
    const bodyStart = resolution.index + resolution[0].length
    const close = result.indexOf('}', bodyStart)
    if (close !== -1 && !/\bgoogle\(\)/.test(result.slice(bodyStart, close))) {
      result = `${result.slice(0, bodyStart)}${newline}        google()${result.slice(bodyStart)}`
    }
  }

  return result
}

/**
 * A project's `build.gradle.kts`.
 *
 * @remarks
 * The shape is fixed because mnci edits it: plugins from the catalog, the build directory moved to
 * `dist/gradle/<name>`, and the project's own dependencies between two marker comments. AGP 9 compiles Kotlin itself, so
 * there is no Kotlin plugin. An application also gets `packageApk`, which copies the debug APK to `dist/drop` (release
 * signing is the team's and never generated).
 *
 * @param kind - Which Android kind.
 * @param group - The Maven group, which is also the base of the package.
 * @param name - The project name.
 * @returns The text of `build.gradle.kts`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function androidBuildFile (kind: AndroidKind, group: string, name: string): string {
  const app = kind === 'android-app'
  const namespace = `${group}.${javaPackageSegment(name)}`
  const plugins = app
    ? '    alias(libs.plugins.android.application)\n    alias(libs.plugins.kotlin.compose)\n    alias(libs.plugins.ktlint)'
    : '    alias(libs.plugins.android.library)\n    alias(libs.plugins.ktlint)'
  const applicationId = app ? `\n        applicationId = "${namespace}"` : ''
  const versions = app ? '\n        targetSdk = ' + ANDROID_COMPILE_SDK + '\n        versionCode = 1\n        versionName = "0.1.0"' : ''
  const features = app ? '\n\n    buildFeatures {\n        compose = true\n    }' : ''
  const compose = app
    ? '\n    implementation(platform(libs.androidx.compose.bom))\n    implementation(libs.androidx.compose.material3)\n    implementation(libs.androidx.activity.compose)'
    : ''
  const apk = app
    ? `
// The debug APK, copied where the other kinds put what they package.
tasks.register<Copy>("packageApk") {
    dependsOn("assembleDebug")
    from(layout.buildDirectory.dir("outputs/apk/debug")) {
        include("*.apk")
    }
    into(rootProject.layout.projectDirectory.dir("dist/drop"))
    rename { "android-app-${name}.apk" }
}
`
    : ''

  return `plugins {
${plugins}
}

group = "${group}"
version = "0.1.0"

layout.buildDirectory = rootProject.layout.projectDirectory.dir("dist/gradle/${name}")

android {
    namespace = "${namespace}"
    compileSdk = ${ANDROID_COMPILE_SDK}

    defaultConfig {${applicationId}
        minSdk = ${ANDROID_MIN_SDK}${versions}
    }${features}
}

dependencies {
    ${GRADLE_DEPENDENCIES_BEGIN}
    ${GRADLE_DEPENDENCIES_END}${compose}
    testImplementation(libs.junit)
}
${apk}`
}

/**
 * The project's `.editorconfig`, which tells ktlint that a composable function is named like a type.
 *
 * @remarks
 * Compose names a UI function in PascalCase, which ktlint's function-naming rule rejects unless told the annotation
 * excuses it. The setting is the documented one for Compose.
 *
 * @param None - this function takes no parameters.
 * @returns The text of `.editorconfig`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function androidEditorConfig (): string {
  return `# Written by MoNecromanCI.
[*.{kt,kts}]
ktlint_function_naming_ignore_when_annotated_with = Composable
`
}

/**
 * The application's `AndroidManifest.xml`.
 *
 * @remarks
 * One launcher activity, `MainActivity`, which `src/main/kotlin/<package>/MainActivity.kt` defines. The label is the project
 * name; an icon and a theme are the team's to add (Android Lint reports the missing icon as a warning).
 *
 * @param name - The project name.
 * @returns The manifest.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function androidAppManifest (name: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="${name}">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`
}

/**
 * The files of the worked example, as paths relative to the project to contents.
 *
 * @remarks
 * A package slice with the role in the type name, like the Kotlin kinds: `greeting` holds a `GreetingContract` and a
 * `GreetUseCase`, with a JUnit 4 test beside them under `src/test`. An application adds `GreetingComponent.kt` (a
 * composable, the Android UI's front-end role) and a `MainActivity` that only wires and sits at the root of the base
 * package, where the manifest names it.
 *
 * @param kind - Which Android kind.
 * @param group - The Maven group.
 * @param name - The project name.
 * @returns The files to write.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function androidExampleFiles (kind: AndroidKind, group: string, name: string): Record<string, string> {
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

import org.junit.Assert.assertEquals
import org.junit.Test

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
  if (kind === 'android-app') {
    files['src/main/AndroidManifest.xml'] = androidAppManifest(name)
    files[`src/main/kotlin/${path}/greeting/GreetingComponent.kt`] = `package ${base}.greeting

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

/** Shows a greeting. */
@Composable
fun Greeting(greeting: GreetingContract) {
    Text(text = greeting.message)
}
`
    files[`src/main/kotlin/${path}/MainActivity.kt`] = `package ${base}

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import ${base}.greeting.GreetUseCase
import ${base}.greeting.Greeting

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            Greeting(GreetUseCase.greet("world"))
        }
    }
}
`
  }

  return files
}

/**
 * The files of a bare project (`--empty`): the smallest source that still builds.
 *
 * @remarks
 * An application keeps its manifest and a `MainActivity` that shows nothing, and no test. A library keeps no source at
 * all: an AAR with no classes still builds, and a file with nothing but a package line is what ktlint rejects.
 *
 * @param kind - Which Android kind.
 * @param group - The Maven group.
 * @param name - The project name.
 * @returns The files to write.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function androidEmptyFiles (kind: AndroidKind, group: string, name: string): Record<string, string> {
  if (kind !== 'android-app') {
    return {}
  }
  const base = `${group}.${javaPackageSegment(name)}`

  return {
    'src/main/AndroidManifest.xml':                                   androidAppManifest(name),
    [`src/main/kotlin/${base.replaceAll('.', '/')}/MainActivity.kt`]: `package ${base}

import android.os.Bundle
import androidx.activity.ComponentActivity

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The application starts here.
    }
}
`,
  }
}
