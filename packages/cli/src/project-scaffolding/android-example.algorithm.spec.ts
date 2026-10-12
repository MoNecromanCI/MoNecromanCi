import {
  androidBuildFile,
  androidEditorConfig,
  androidEmptyFiles,
  androidExampleFiles,
  withAndroidCatalog,
  withGoogleRepository,
} from './android-example.algorithm'
import { gradleCatalog, gradleSettings } from './kotlin-example.algorithm'

describe('withAndroidCatalog', () => {
  it('adds the Android versions, libraries and plugins to the Kotlin catalog and keeps what was there', () => {
    const text = withAndroidCatalog(gradleCatalog())

    expect(text).toContain('kotlin = "2.4.21"')
    expect(text).toContain('agp = "9.4.1"')
    expect(text).toContain('android-application = { id = "com.android.application", version.ref = "agp" }')
    expect(text).toContain('kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }')
    expect(text).toContain('androidx-compose-bom = { module = "androidx.compose:compose-bom", version.ref = "compose-bom" }')
    expect(text.indexOf('agp =')).toBeLessThan(text.indexOf('[libraries]'))
    expect(text.indexOf('android-application =')).toBeGreaterThan(text.indexOf('[plugins]'))
  })

  it('is idempotent and leaves a key the team already declared as it is', () => {
    const once = withAndroidCatalog(gradleCatalog().replace('[libraries]\n', '[libraries]\njunit = { module = "junit:junit", version = "4.12" }\n'))

    expect(withAndroidCatalog(once)).toBe(once)
    expect(once).toContain('junit = { module = "junit:junit", version = "4.12" }')
    expect(once.match(/^junit = \{/gm)).toHaveLength(1)
  })

  it('keeps CRLF line endings', () => {
    expect(withAndroidCatalog(gradleCatalog().replaceAll('\n', '\r\n'))).not.toMatch(/[^\r]\n/)
  })
})

describe('withGoogleRepository', () => {
  it('adds pluginManagement and google() to the repositories of a Kotlin settings file', () => {
    const text = withGoogleRepository(gradleSettings('hello', 'apps/hello'))

    expect(text).toMatch(/pluginManagement \{\s+repositories \{\s+google\(\)/)
    expect(text).toMatch(/dependencyResolutionManagement \{\s+repositories \{\s+google\(\)\s+mavenCentral\(\)/)
    expect(text).toContain('include(":hello")')
  })

  it('is idempotent', () => {
    const once = withGoogleRepository(gradleSettings('hello', 'apps/hello'))

    expect(withGoogleRepository(once)).toBe(once)
  })
})

describe('androidBuildFile', () => {
  it('makes an app the application plugin with compose, the dependency markers and a packageApk task', () => {
    const text = androidBuildFile('android-app', 'com.example', 'my-app')

    expect(text).toContain('alias(libs.plugins.android.application)')
    expect(text).toContain('namespace = "com.example.myapp"')
    expect(text).toContain('applicationId = "com.example.myapp"')
    expect(text).toContain('compileSdk = 37')
    expect(text).toContain('layout.buildDirectory = rootProject.layout.projectDirectory.dir("dist/gradle/my-app")')
    expect(text).toContain('// mnci:dependencies\n    // mnci:dependencies-end')
    expect(text).toContain('rename { "android-app-my-app.apk" }')
    expect(text).toContain('version = "0.1.0"')
  })

  it('makes a library the library plugin with no compose and no packaging', () => {
    const text = androidBuildFile('android-lib', 'com.example', 'kit')

    expect(text).toContain('alias(libs.plugins.android.library)')
    expect(text).not.toContain('compose')
    expect(text).not.toContain('packageApk')
    expect(text).not.toContain('applicationId')
  })
})

describe('androidExampleFiles and androidEmptyFiles', () => {
  it('writes a greeting slice, a composable component, a MainActivity that only wires, and the manifest', () => {
    expect(Object.keys(androidExampleFiles('android-app', 'com.example', 'my-app')).sort((a, b) => a.localeCompare(b))).toEqual([
      'src/main/AndroidManifest.xml',
      'src/main/kotlin/com/example/myapp/greeting/GreetingComponent.kt',
      'src/main/kotlin/com/example/myapp/greeting/GreetingContract.kt',
      'src/main/kotlin/com/example/myapp/greeting/GreetUseCase.kt',
      'src/main/kotlin/com/example/myapp/MainActivity.kt',
      'src/test/kotlin/com/example/myapp/greeting/GreetUseCaseTest.kt',
    ])
  })

  it('has no UI and no manifest in a library', () => {
    const files = Object.keys(androidExampleFiles('android-lib', 'com.example', 'kit'))

    expect(files.some(file => file.endsWith('AndroidManifest.xml') || file.endsWith('Component.kt') || file.endsWith('MainActivity.kt'))).toBe(false)
  })

  it('has a bare app with an empty activity and a bare library with no source', () => {
    expect(Object.keys(androidEmptyFiles('android-app', 'com.example', 'kit')).sort((a, b) => a.localeCompare(b))).toEqual([
      'src/main/AndroidManifest.xml',
      'src/main/kotlin/com/example/kit/MainActivity.kt',
    ])
    expect(androidEmptyFiles('android-lib', 'com.example', 'kit')).toEqual({})
  })

  it('tells ktlint a composable is named like a type', () => {
    expect(androidEditorConfig()).toContain('ktlint_function_naming_ignore_when_annotated_with = Composable')
  })
})
