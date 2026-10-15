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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAdd } from './add-project.use-case'
import { addCppDevTargets } from './cpp.use-case'
import { cppCmakeLists } from './cpp-example.algorithm'

let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-cpp-'))
  jest.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  writeFileSync(join(workspaceRoot, 'nx.json'), '{}')
  writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({ name: '@demo/source', devDependencies: {} }))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
})

describe('runAdd cpp-app', () => {
  it('writes a CMake project with a greeting slice behind its barrel, a test, and a main that only wires', async () => {
    await runAdd('cpp-app', 'hello', {})

    const root = join(workspaceRoot, 'apps/hello')
    for (const file of [
      'CMakeLists.txt',
      'src/main.cpp',
      'src/hello/greeting/greeting.hpp',
      'src/hello/greeting/greeting_contract.hpp',
      'src/hello/greeting/greet_use_case.hpp',
      'src/hello/greeting/greet_use_case.cpp',
      'src/hello/greeting/greet_use_case_test.cpp',
    ]) {
      expect(existsSync(join(root, file))).toBe(true)
    }
    const cmake = readFileSync(join(root, 'CMakeLists.txt'), 'utf8')
    expect(cmake).toContain('project(hello VERSION 0.1.0 LANGUAGES CXX)')
    expect(cmake).toContain('add_test(NAME hello_tests COMMAND hello_tests)')
    expect(cmake).toContain('-Wall -Wextra -Wpedantic -Werror')
  })

  it('has build, build-dev, test, lint, start and package targets, each building into its own directory', async () => {
    await runAdd('cpp-app', 'hello', {})

    const { targets, tags } = JSON.parse(readFileSync(join(workspaceRoot, 'apps/hello/project.json'), 'utf8'))
    expect(Object.keys(targets)).toEqual(['build', 'build-dev', 'test', 'slice-check', 'lint', 'start', 'dev', 'package'])
    expect(tags).toEqual(['type:cpp-app'])
    expect(targets.build.outputs).toEqual(['{workspaceRoot}/dist/cmake/hello'])
    expect(targets.build.options.commands[0]).toBe('cmake -S apps/hello -B dist/cmake/hello -DCMAKE_BUILD_TYPE=Release')
    expect(targets['build-dev'].outputs).toEqual(['{workspaceRoot}/dist/cmake/hello-debug'])
    expect(targets.lint.options.command).toContain('cppcheck --error-exitcode=1')
    expect(targets.package.outputs).toEqual(['{workspaceRoot}/dist/drop/cpp-app-hello.zip'])
  })

  it('--empty is an entry point that does nothing, with no test', async () => {
    await runAdd('cpp-app', 'hello', { empty: true })

    const root = join(workspaceRoot, 'apps/hello')
    expect(readFileSync(join(root, 'src/main.cpp'), 'utf8')).toBe('int main() { return 0; }\n')
    expect(readFileSync(join(root, 'CMakeLists.txt'), 'utf8')).not.toContain('add_test')
  })

  it('registers the per-project scripts', async () => {
    await runAdd('cpp-app', 'hello', {})

    const { scripts } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(scripts['hello:qa']).toBe('nx run hello:lint && nx run hello:test')
    expect(scripts['hello:start']).toBe('nx run hello:start')
    expect(scripts['hello:build:dev']).toBe('nx run hello:build-dev')
    expect(scripts['hello:dev']).toBe('nx run hello:dev')
  })
})

describe('runAdd cpp libraries', () => {
  it('puts a publishable library under packages/ with release by tag, and a private one under libs/ without', async () => {
    await runAdd('cpp-lib', 'core', {})
    await runAdd('cpp-internal-lib', 'kit', {})

    const publishable = JSON.parse(readFileSync(join(workspaceRoot, 'packages/core/project.json'), 'utf8'))
    expect(publishable.release.version.versionActions).toBe('tools/cmake-version-actions.cjs')
    expect(Object.keys(publishable.targets)).toContain('nx-release-publish')
    expect(existsSync(join(workspaceRoot, 'tools/cmake-version-actions.cjs'))).toBe(true)
    const internal = JSON.parse(readFileSync(join(workspaceRoot, 'libs/kit/project.json'), 'utf8'))
    expect(internal.release).toBeUndefined()
    expect(Object.keys(internal.targets)).not.toContain('package')
  })

  it('a library is a static library whose headers sit under src/<name>/, and a bare one is an interface library', () => {
    expect(cppCmakeLists('cpp-lib', 'core', false)).toContain('add_library(core STATIC src/core/greeting/greet_use_case.cpp)')
    expect(cppCmakeLists('cpp-lib', 'core', true)).toContain('add_library(core INTERFACE)')
  })

  it('names the CMake targets by identifier when the project name has a hyphen', () => {
    const text = cppCmakeLists('cpp-app', 'my-tool', false)

    expect(text).toContain('project(my-tool VERSION 0.1.0 LANGUAGES CXX)')
    expect(text).toContain('add_executable(my_tool src/main.cpp src/my_tool/greeting/greet_use_case.cpp)')
    expect(text).toContain('set_target_properties(my_tool PROPERTIES OUTPUT_NAME my-tool)')
  })
})

const app = (name: string, tags: string[], targets: Record<string, unknown> = {}): void => {
  mkdirSync(join(workspaceRoot, 'apps', name), { recursive: true })
  writeFileSync(join(workspaceRoot, 'apps', name, 'project.json'), JSON.stringify({ name, tags, targets }))
}
const dev = (name: string): unknown => (JSON.parse(readFileSync(join(workspaceRoot, 'apps', name, 'project.json'), 'utf8')) as { targets: Record<string, unknown> }).targets.dev

describe('addCppDevTargets', () => {
  it('adds dev to a C++ app that predates it, but not to another kind or an app with its own', () => {
    app('hello', ['type:cpp-app'])
    app('mine', ['type:cpp-app'], { dev: { command: 'my own' } })
    app('web', ['type:react-app'])

    expect(addCppDevTargets(workspaceRoot)).toEqual(['apps/hello/project.json'])
    expect(dev('hello')).toEqual({
      executor:   'nx:run-commands',
      continuous: true,
      options:    { command: 'nx watch --projects=hello --includeDependencies --initialRun -- nx run hello:build-dev' },
    })
    expect(dev('mine')).toEqual({ command: 'my own' })
    expect(dev('web')).toBeUndefined()
  })

  it('does nothing without an apps folder', () => {
    expect(addCppDevTargets(workspaceRoot)).toEqual([])
  })
})
