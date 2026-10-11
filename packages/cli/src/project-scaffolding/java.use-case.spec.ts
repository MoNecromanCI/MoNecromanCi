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
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-java-'))
  jest.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  writeFileSync(join(workspaceRoot, 'nx.json'), '{}')
  writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({ name: '@demo/source', devDependencies: {} }))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
})

describe('runAdd java-app', () => {
  it('writes a Maven module with a greeting package, a test beside it, and a Main that only wires', async () => {
    await runAdd('java-app', 'hello', {})

    const root = join(workspaceRoot, 'apps/hello')
    for (const file of [
      'pom.xml',
      'src/main/java/com/example/hello/Main.java',
      'src/main/java/com/example/hello/greeting/GreetUseCase.java',
      'src/main/java/com/example/hello/greeting/GreetingContract.java',
      'src/test/java/com/example/hello/greeting/GreetUseCaseTest.java',
    ]) {
      expect(existsSync(join(root, file))).toBe(true)
    }
    const pom = readFileSync(join(root, 'pom.xml'), 'utf8')
    expect(pom).toContain('<artifactId>hello</artifactId>')
    expect(pom).toContain('<mainClass>com.example.hello.Main</mainClass>')
  })

  it('creates the aggregator pom.xml, the checkstyle rules and the slice check beside the project', async () => {
    await runAdd('java-app', 'hello', {})

    expect(readFileSync(join(workspaceRoot, 'pom.xml'), 'utf8')).toContain('<module>apps/hello</module>')
    expect(existsSync(join(workspaceRoot, 'tools/checkstyle.xml'))).toBe(true)
    expect(existsSync(join(workspaceRoot, 'tools/slice-check.cjs'))).toBe(true)
  })

  it('has build, test, slice-check, lint, start and package targets, each scoped to its module', async () => {
    await runAdd('java-app', 'hello', {})

    const { targets, tags } = JSON.parse(readFileSync(join(workspaceRoot, 'apps/hello/project.json'), 'utf8'))
    expect(Object.keys(targets)).toEqual(['build', 'test', 'slice-check', 'lint', 'start', 'package'])
    expect(tags).toEqual(['type:java-app'])
    expect(targets.build.outputs).toEqual(['{workspaceRoot}/dist/maven/hello'])
    expect(targets.build.options.command).toBe('mvn -B -ntp -pl apps/hello -am package -DskipTests')
    expect(targets.lint.dependsOn).toEqual(['slice-check'])
    expect(targets.lint.options.command).toContain('checkstyle:check')
    expect(targets.package.outputs).toEqual(['{workspaceRoot}/dist/drop/java-app-hello.zip'])
  })

  it('--empty is a Main that does nothing and no test', async () => {
    await runAdd('java-app', 'hello', { empty: true })

    const root = join(workspaceRoot, 'apps/hello')
    expect(readFileSync(join(root, 'src/main/java/com/example/hello/Main.java'), 'utf8')).toContain('Intentionally empty')
    expect(existsSync(join(root, 'src/test'))).toBe(false)
  })

  it('registers the per-project scripts', async () => {
    await runAdd('java-app', 'hello', {})

    const { scripts } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(scripts['hello:lint']).toBe('nx run hello:lint')
    expect(scripts['hello:start']).toBe('nx run hello:start')
  })
})

describe('runAdd java-lib and java-internal-lib', () => {
  it('puts a publishable library under packages/ and wires release by tag', async () => {
    await runAdd('java-lib', 'core', {})

    const project = JSON.parse(readFileSync(join(workspaceRoot, 'packages/core/project.json'), 'utf8'))
    expect(project.release.version.versionActions).toBe('tools/maven-version-actions.cjs')
    expect(Object.keys(project.targets)).toContain('nx-release-publish')
    expect(existsSync(join(workspaceRoot, 'tools/maven-version-actions.cjs'))).toBe(true)
  })

  it('puts a private library under libs/, with no release and no start', async () => {
    await runAdd('java-internal-lib', 'kit', {})

    const project = JSON.parse(readFileSync(join(workspaceRoot, 'libs/kit/project.json'), 'utf8'))
    expect(project.release).toBeUndefined()
    expect(Object.keys(project.targets)).toEqual(['build', 'test', 'slice-check', 'lint'])
  })

  it('lists every module in the one aggregator and keeps the first group id', async () => {
    await runAdd('java-lib', 'core', {})
    await runAdd('java-internal-lib', 'kit', {})

    const pom = readFileSync(join(workspaceRoot, 'pom.xml'), 'utf8')
    expect(pom).toContain('<module>packages/core</module>')
    expect(pom).toContain('<module>libs/kit</module>')
    expect(pom.match(/<modules>/g)).toHaveLength(1)
  })
})
