import {
  addGradleProject,
  gradleSettings,
  kotlinBuildFile,
  kotlinEmptyFiles,
  kotlinExampleFiles,
} from './kotlin-example.algorithm'

describe('gradleSettings and addGradleProject', () => {
  it('includes the first project and maps it to its directory', () => {
    const text = gradleSettings('hello', 'apps/hello')

    expect(text).toContain('include(":hello")\nproject(":hello").projectDir = file("apps/hello")\n// mnci:projects-end')
    expect(text).toContain('mavenCentral()')
  })

  it('adds a second project before the end marker, once', () => {
    const once = addGradleProject(gradleSettings('hello', 'apps/hello'), 'core', 'packages/core')

    expect(once).toContain('include(":core")\nproject(":core").projectDir = file("packages/core")\n// mnci:projects-end')
    expect(addGradleProject(once, 'core', 'packages/core')).toBe(once)
  })

  it('leaves a settings file with no marker alone', () => {
    expect(addGradleProject('rootProject.name = "x"\n', 'core', 'packages/core')).toBe('rootProject.name = "x"\n')
  })
})

describe('kotlinBuildFile', () => {
  it('moves the build directory to dist/gradle and carries the dependency markers', () => {
    const text = kotlinBuildFile('kotlin-lib', 'com.example', 'kit')

    expect(text).toContain('layout.buildDirectory = rootProject.layout.projectDirectory.dir("dist/gradle/kit")')
    expect(text).toContain('// mnci:dependencies\n    // mnci:dependencies-end')
    expect(text).toContain('version = "0.1.0"')
    expect(text).not.toContain('application')
  })

  it('makes an app the application plugin, with its entry point and a distribution zip in dist/drop', () => {
    const text = kotlinBuildFile('kotlin-app', 'com.example', 'my-app')

    expect(text).toContain('mainClass = "com.example.myapp.MainKt"')
    expect(text).toContain('archiveFileName = "kotlin-app-my-app.zip"')
  })
})

describe('kotlinExampleFiles and kotlinEmptyFiles', () => {
  it('writes a package slice with the role in the type name, a test beside it, and Main for an app', () => {
    expect(Object.keys(kotlinExampleFiles('kotlin-app', 'com.example', 'my-app')).sort((a, b) => a.localeCompare(b))).toEqual([
      'src/main/kotlin/com/example/myapp/greeting/GreetingContract.kt',
      'src/main/kotlin/com/example/myapp/greeting/GreetUseCase.kt',
      'src/main/kotlin/com/example/myapp/Main.kt',
      'src/test/kotlin/com/example/myapp/greeting/GreetUseCaseTest.kt',
    ])
  })

  it('keeps ktlint\'s official style: one property per line and a trailing comma', () => {
    const contract = kotlinExampleFiles('kotlin-lib', 'com.example', 'kit')['src/main/kotlin/com/example/kit/greeting/GreetingContract.kt']

    expect(contract).toContain('data class GreetingContract(\n    val message: String,\n)')
  })

  it('has a bare library with no source and a bare app with an empty main', () => {
    expect(kotlinEmptyFiles('kotlin-lib', 'com.example', 'kit')).toEqual({})
    expect(Object.keys(kotlinEmptyFiles('kotlin-app', 'com.example', 'kit'))).toEqual(['src/main/kotlin/com/example/kit/Main.kt'])
  })
})
