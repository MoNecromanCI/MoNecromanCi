jest.mock('../nx-workspace', () => ({
  runNx:        jest.fn(),
  runFormatter: jest.fn(),
  runShell:     jest.fn(() => 0),
  runCapture:   jest.fn(() => ({ status: 0, stdout: '' })),
}))
jest.mock('../terminal', () => ({
  ...jest.requireActual('../terminal'),
  promptText: jest.fn(),
}))
jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAdd } from './add-project.use-case'

let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-kotlin-'))
  jest.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  writeFileSync(join(workspaceRoot, 'nx.json'), '{}')
  writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({ name: '@demo/source', devDependencies: {} }))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
})

describe('runAdd kotlin-app', () => {
  it('writes a Gradle project with a greeting package, a test beside it, and a Main that only wires', async () => {
    await runAdd('kotlin-app', 'hello', {})

    const root = join(workspaceRoot, 'apps/hello')
    for (const file of [
      'build.gradle.kts',
      'src/main/kotlin/com/example/hello/Main.kt',
      'src/main/kotlin/com/example/hello/greeting/GreetUseCase.kt',
      'src/main/kotlin/com/example/hello/greeting/GreetingContract.kt',
      'src/test/kotlin/com/example/hello/greeting/GreetUseCaseTest.kt',
    ]) {
      expect(existsSync(join(root, file))).toBe(true)
    }
    const build = readFileSync(join(root, 'build.gradle.kts'), 'utf8')
    expect(build).toContain('mainClass = "com.example.hello.MainKt"')
    expect(build).toContain('// mnci:dependencies')
  })

  it('creates settings.gradle.kts, the version catalog, the properties and the slice check at the root', async () => {
    await runAdd('kotlin-app', 'hello', {})

    expect(readFileSync(join(workspaceRoot, 'settings.gradle.kts'), 'utf8')).toContain('include(":hello")')
    expect(readFileSync(join(workspaceRoot, 'gradle/libs.versions.toml'), 'utf8')).toContain('org.jetbrains.kotlin.jvm')
    expect(existsSync(join(workspaceRoot, 'gradle.properties'))).toBe(true)
    expect(existsSync(join(workspaceRoot, 'tools/slice-check.cjs'))).toBe(true)
  })

  it('has build, test, slice-check, lint, start and package targets, each scoped to its project path', async () => {
    await runAdd('kotlin-app', 'hello', {})

    const { targets, tags } = JSON.parse(readFileSync(join(workspaceRoot, 'apps/hello/project.json'), 'utf8'))
    expect(Object.keys(targets)).toEqual(['build', 'test', 'slice-check', 'lint', 'start', 'package'])
    expect(tags).toEqual(['type:kotlin-app'])
    expect(targets.build.outputs).toEqual(['{workspaceRoot}/dist/gradle/hello'])
    expect(targets.build.options.command).toBe('gradle --console=plain :hello:assemble')
    expect(targets.build.dependsOn).toEqual(['^build'])
    expect(targets.lint.dependsOn).toEqual(['slice-check'])
    expect(targets.package.outputs).toEqual(['{workspaceRoot}/dist/drop/kotlin-app-hello.zip'])
  })

  it('--empty is a Main that does nothing and no test', async () => {
    await runAdd('kotlin-app', 'hello', { empty: true })

    const root = join(workspaceRoot, 'apps/hello')
    expect(readFileSync(join(root, 'src/main/kotlin/com/example/hello/Main.kt'), 'utf8')).toContain('The application starts here')
    expect(existsSync(join(root, 'src/test'))).toBe(false)
  })

  it('ignores Gradle\'s and Kotlin\'s working folders', async () => {
    writeFileSync(join(workspaceRoot, '.gitignore'), 'node_modules\n')
    await runAdd('kotlin-app', 'hello', {})

    const ignored = readFileSync(join(workspaceRoot, '.gitignore'), 'utf8')
    expect(ignored).toContain('.gradle/')
    expect(ignored).toContain('.kotlin/')
  })

  it('registers the per-project scripts', async () => {
    await runAdd('kotlin-app', 'hello', {})

    const { scripts } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(scripts['hello:lint']).toBe('nx run hello:lint')
    expect(scripts['hello:start']).toBe('nx run hello:start')
  })
})

describe('runAdd kotlin-lib and kotlin-internal-lib', () => {
  it('puts a publishable library under packages/ and wires release by tag', async () => {
    await runAdd('kotlin-lib', 'core', {})

    const project = JSON.parse(readFileSync(join(workspaceRoot, 'packages/core/project.json'), 'utf8'))
    expect(project.release.version.versionActions).toBe('tools/gradle-version-actions.cjs')
    expect(Object.keys(project.targets)).toContain('nx-release-publish')
    expect(existsSync(join(workspaceRoot, 'tools/gradle-version-actions.cjs'))).toBe(true)
  })

  it('puts a private library under libs/, with no release and no start', async () => {
    await runAdd('kotlin-internal-lib', 'kit', {})

    const project = JSON.parse(readFileSync(join(workspaceRoot, 'libs/kit/project.json'), 'utf8'))
    expect(project.release).toBeUndefined()
    expect(Object.keys(project.targets)).toEqual(['build', 'test', 'slice-check', 'lint'])
  })

  it('includes every project in the one settings file and keeps one catalog', async () => {
    await runAdd('kotlin-lib', 'core', {})
    await runAdd('kotlin-internal-lib', 'kit', {})

    const settings = readFileSync(join(workspaceRoot, 'settings.gradle.kts'), 'utf8')
    expect(settings).toContain('project(":core").projectDir = file("packages/core")')
    expect(settings).toContain('project(":kit").projectDir = file("libs/kit")')
    expect(settings.match(/mnci:projects-end/g)).toHaveLength(1)
  })
})
