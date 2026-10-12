jest.mock('../nx-workspace', () => ({
  runNx:        jest.fn(),
  runFormatter: jest.fn(),
  runShell:     jest.fn(() => 0),
  runCapture:   jest.fn(() => ({ status: 0, stdout: 'Gradle 9.8.1\n' })),
}))
jest.mock('../terminal', () => ({
  ...jest.requireActual('../terminal'),
  promptText: jest.fn(),
}))
jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCapture } from '../nx-workspace'
import { runAdd } from './add-project.use-case'

const mockRunCapture = jest.mocked(runCapture)
let workspaceRoot: string
let warnings: string[]

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-android-'))
  warnings = []
  jest.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation((message: unknown) => { warnings.push(String(message)) })
  writeFileSync(join(workspaceRoot, 'nx.json'), '{}')
  writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({ name: '@demo/source', devDependencies: {} }))
  mockRunCapture.mockReturnValue({ status: 0, stdout: 'Gradle 9.8.1\n' })
  process.env.ANDROID_HOME = '/sdk'
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
  delete process.env.ANDROID_HOME
})

describe('runAdd android-app', () => {
  it('writes a Gradle project with a manifest, a greeting slice, a composable and a MainActivity', async () => {
    await runAdd('android-app', 'hello', {})

    const root = join(workspaceRoot, 'apps/hello')
    for (const file of [
      'build.gradle.kts',
      '.editorconfig',
      'src/main/AndroidManifest.xml',
      'src/main/kotlin/com/example/hello/MainActivity.kt',
      'src/main/kotlin/com/example/hello/greeting/GreetingComponent.kt',
      'src/test/kotlin/com/example/hello/greeting/GreetUseCaseTest.kt',
    ]) {
      expect(existsSync(join(root, file))).toBe(true)
    }
    expect(readFileSync(join(root, 'build.gradle.kts'), 'utf8')).toContain('namespace = "com.example.hello"')
  })

  it('puts Google\'s repository and the Android entries in the shared settings and catalog', async () => {
    await runAdd('android-app', 'hello', {})

    expect(readFileSync(join(workspaceRoot, 'settings.gradle.kts'), 'utf8')).toMatch(/pluginManagement \{\s+repositories \{\s+google\(\)/)
    expect(readFileSync(join(workspaceRoot, 'settings.gradle.kts'), 'utf8')).toContain('include(":hello")')
    expect(readFileSync(join(workspaceRoot, 'gradle/libs.versions.toml'), 'utf8')).toContain('com.android.application')
    expect(readFileSync(join(workspaceRoot, 'gradle.properties'), 'utf8')).toContain('-Xmx2g')
  })

  it('has build, test, slice-check, lint and package targets and no start, since running needs a device', async () => {
    await runAdd('android-app', 'hello', {})

    const { targets, tags } = JSON.parse(readFileSync(join(workspaceRoot, 'apps/hello/project.json'), 'utf8'))
    expect(Object.keys(targets)).toEqual(['build', 'test', 'slice-check', 'lint', 'package'])
    expect(tags).toEqual(['type:android-app'])
    expect(targets.build.options.command).toBe('gradle --console=plain :hello:assembleDebug')
    expect(targets.test.options.command).toBe('gradle --console=plain :hello:testDebugUnitTest')
    expect(targets.lint.options.command).toBe('gradle --console=plain :hello:ktlintCheck :hello:lintDebug')
    expect(targets.lint.dependsOn).toEqual(['slice-check', 'build', '^lint'])
    expect(targets['slice-check'].options.command).toBe('node tools/slice-check.cjs android apps/hello')
    expect(targets.package.outputs).toEqual(['{workspaceRoot}/dist/drop/android-app-hello.apk'])
  })

  it('ignores local.properties, which holds the machine\'s SDK path, and the working folders', async () => {
    writeFileSync(join(workspaceRoot, '.gitignore'), 'node_modules\n')
    await runAdd('android-app', 'hello', {})

    const ignored = readFileSync(join(workspaceRoot, '.gitignore'), 'utf8')
    expect(ignored).toContain('local.properties')
    expect(ignored).toContain('.gradle/')
  })

  it('--empty is an activity that does nothing and no test', async () => {
    await runAdd('android-app', 'hello', { empty: true })

    const root = join(workspaceRoot, 'apps/hello')
    expect(readFileSync(join(root, 'src/main/kotlin/com/example/hello/MainActivity.kt'), 'utf8')).toContain('The application starts here')
    expect(existsSync(join(root, 'src/test'))).toBe(false)
  })
})

describe('runAdd android-lib and android-internal-lib', () => {
  it('puts a publishable library under packages/ and wires release by tag', async () => {
    await runAdd('android-lib', 'core', {})

    const project = JSON.parse(readFileSync(join(workspaceRoot, 'packages/core/project.json'), 'utf8'))
    expect(project.release.version.versionActions).toBe('tools/gradle-version-actions.cjs')
    expect(project.targets.build.options.command).toBe('gradle --console=plain :core:assemble')
    expect(Object.keys(project.targets)).toContain('nx-release-publish')
  })

  it('puts a private library under libs/, with no release and no package', async () => {
    await runAdd('android-internal-lib', 'kit', {})

    const project = JSON.parse(readFileSync(join(workspaceRoot, 'libs/kit/project.json'), 'utf8'))
    expect(project.release).toBeUndefined()
    expect(Object.keys(project.targets)).toEqual(['build', 'test', 'slice-check', 'lint'])
  })

  it('shares the settings file and catalog with the Kotlin kinds', async () => {
    await runAdd('kotlin-lib', 'util', {})
    await runAdd('android-lib', 'core', {})

    const settings = readFileSync(join(workspaceRoot, 'settings.gradle.kts'), 'utf8')
    expect(settings).toContain('project(":util").projectDir = file("packages/util")')
    expect(settings).toContain('project(":core").projectDir = file("packages/core")')
    expect(settings.match(/mnci:projects-end/g)).toHaveLength(1)
    expect(settings.match(/pluginManagement/g)).toHaveLength(1)
  })
})

describe('the toolchain warnings', () => {
  it('names the sdkmanager commands and never accepts a licence when there is no SDK', async () => {
    delete process.env.ANDROID_HOME
    delete process.env.ANDROID_SDK_ROOT

    await runAdd('android-app', 'hello', {})

    const warning = warnings.find(message => message.includes('No Android SDK'))
    expect(warning).toContain('sdkmanager --licenses')
    expect(warning).toContain('platforms;android-37.0')
    expect(warning).toContain('build-tools;36.0.0')
    expect(warning).toContain('never accepts a licence')
  })

  it('says so when Gradle is older than the Android Gradle Plugin needs', async () => {
    mockRunCapture.mockReturnValue({ status: 0, stdout: 'Gradle 8.14.3\n' })

    await runAdd('android-app', 'hello', {})

    expect(warnings.some(message => message.includes('older than 9.6.0'))).toBe(true)
  })

  it('is quiet when the SDK is set and Gradle is new enough', async () => {
    await runAdd('android-app', 'hello', {})

    expect(warnings).toEqual([])
  })
})
