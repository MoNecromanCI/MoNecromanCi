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
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-ruby-'))
  jest.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  writeFileSync(join(workspaceRoot, 'nx.json'), '{}')
  writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({ name: '@demo/source', devDependencies: {} }))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
})

describe('runAdd ruby-app', () => {
  it('writes a Bundler project with a greeting slice behind its barrel, a mirrored spec, and a bin script that only wires', async () => {
    await runAdd('ruby-app', 'hello', {})

    const root = join(workspaceRoot, 'apps/hello')
    for (const file of [
      'Gemfile',
      '.rspec',
      'bin/hello',
      'lib/hello.rb',
      'lib/hello/greeting/greeting_contract.rb',
      'lib/hello/greeting/greet_use_case.rb',
      'spec/spec_helper.rb',
      'spec/greeting/greet_use_case_spec.rb',
    ]) {
      expect(existsSync(join(root, file))).toBe(true)
    }
    expect(existsSync(join(root, 'hello.gemspec'))).toBe(false)
    expect(readFileSync(join(root, 'bin/hello'), 'utf8')).toContain("Hello::Greeting::GreetUseCase.greet('hello')")
  })

  it('writes the root Gemfile of RuboCop and the .rubocop.yml once; RSpec is the project own', async () => {
    await runAdd('ruby-app', 'hello', {})
    await runAdd('ruby-internal-lib', 'kit', {})

    const rootGemfile = readFileSync(join(workspaceRoot, 'Gemfile'), 'utf8')
    expect(rootGemfile).toContain("gem 'rubocop'")
    expect(rootGemfile).not.toContain('rspec')
    expect(readFileSync(join(workspaceRoot, 'apps/hello/Gemfile'), 'utf8')).toContain("gem 'rspec'")
    expect(readFileSync(join(workspaceRoot, '.rubocop.yml'), 'utf8')).toContain('TargetRubyVersion: 3.3')
  })

  it('has build, test, slice-check, lint, start and package targets; Bundler runs in the project directory', async () => {
    await runAdd('ruby-app', 'hello', {})

    const { targets, tags } = JSON.parse(readFileSync(join(workspaceRoot, 'apps/hello/project.json'), 'utf8'))
    expect(Object.keys(targets)).toEqual(['build', 'test', 'slice-check', 'lint', 'start', 'package'])
    expect(tags).toEqual(['type:ruby-app'])
    expect(targets.build.options.cwd).toBe('apps/hello')
    expect(targets.test.options).toEqual({ cwd: 'apps/hello', command: 'bundle exec rspec' })
    expect(targets.lint.dependsOn).toEqual(['slice-check'])
    expect(targets.lint.options.commands).toEqual(['bundle install', 'bundle exec rubocop --config .rubocop.yml apps/hello'])
    expect(targets.package.outputs).toEqual(['{workspaceRoot}/dist/drop/ruby-app-hello.zip'])
  })

  it('--empty keeps one smoke spec, because RSpec exits non-zero on no examples, and an entry script that does nothing', async () => {
    await runAdd('ruby-app', 'hello', { empty: true })

    const root = join(workspaceRoot, 'apps/hello')
    expect(existsSync(join(root, 'spec/smoke_spec.rb'))).toBe(true)
    expect(readFileSync(join(root, 'bin/hello'), 'utf8')).not.toContain('Greeting')
    expect(existsSync(join(root, 'lib/hello/greeting'))).toBe(false)
  })
})

describe('runAdd ruby-lib and ruby-internal-lib', () => {
  it('is a gem: a gemspec that reads lib/<name>/version.rb, built into dist/gems, released by tag', async () => {
    await runAdd('ruby-lib', 'core', {})

    const root = join(workspaceRoot, 'packages/core')
    expect(readFileSync(join(root, 'core.gemspec'), 'utf8')).toContain('spec.version = Core::VERSION')
    expect(readFileSync(join(root, 'lib/core/version.rb'), 'utf8')).toContain("VERSION = '0.1.0'")
    expect(readFileSync(join(root, 'Gemfile'), 'utf8')).toContain('gemspec')
    const project = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'))
    expect(project.release.version.versionActions).toBe('tools/ruby-version-actions.cjs')
    expect(project.targets.build.options.commands).toEqual(['bundle install', 'gem build core.gemspec --output ../../dist/gems/core.gem'])
    expect(project.targets.build.outputs).toEqual(['{workspaceRoot}/dist/gems/core.gem'])
  })

  it('a private library has a gemspec (Bundler needs one for a path source) but no release and no start', async () => {
    await runAdd('ruby-internal-lib', 'my-kit', {})

    const root = join(workspaceRoot, 'libs/my-kit')
    expect(existsSync(join(root, 'my-kit.gemspec'))).toBe(true)
    expect(existsSync(join(root, 'lib/my_kit/greeting/greet_use_case.rb'))).toBe(true)
    const project = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'))
    expect(project.release).toBeUndefined()
    expect(Object.keys(project.targets)).toEqual(['build', 'test', 'slice-check', 'lint'])
  })
})
