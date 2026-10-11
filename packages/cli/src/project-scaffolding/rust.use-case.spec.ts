jest.mock('../nx-workspace', () => ({
  runNx:        jest.fn(),
  runFormatter: jest.fn(),
  runShell:     jest.fn(() => 0),
}))
jest.mock('../terminal', () => ({
  ...jest.requireActual('../terminal'),
  promptText: jest.fn(),
}))
jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runNx } from '../nx-workspace'
import { runAdd } from './add-project.use-case'

const mockRunNx = jest.mocked(runNx)

let workspaceRoot: string

/**
 * What `@monodon/rust:binary|library --name=hello` writes, under whichever folder `nx.json`'s `workspaceLayout` names
 * at that moment: the plugin places a crate by that layout, so this reads it as the real plugin does.
 */
function writeGenerated (binary: boolean): void {
  const layout = JSON.parse(readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')).workspaceLayout as { appsDir: string, libsDir: string }
  const root = join(workspaceRoot, binary ? layout.appsDir : layout.libsDir, 'hello')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'Cargo.toml'), '[package]\nname = "hello"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n')
  writeFileSync(join(root, 'project.json'), JSON.stringify({
    name:    'hello',
    targets: {
      build: { executor: '@monodon/rust:build', options: { 'target-dir': 'dist/target/hello' } },
      lint:  { executor: '@monodon/rust:lint', options: { 'target-dir': 'dist/target/hello' } },
    },
  }))
  writeFileSync(join(root, 'src', binary ? 'main.rs' : 'lib.rs'), 'sample')
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-rust-'))
  jest.spyOn(process, 'cwd').mockReturnValue(workspaceRoot)
  jest.spyOn(console, 'log').mockImplementation(() => {})
  writeFileSync(join(workspaceRoot, 'nx.json'), '{}')
  writeFileSync(join(workspaceRoot, 'package.json'), JSON.stringify({ name: '@demo/source', devDependencies: {} }))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
  jest.restoreAllMocks()
  mockRunNx.mockReset()
})

describe('runAdd rust-app', () => {
  beforeEach(() => {
    mockRunNx.mockImplementation((arguments_: string[]) => {
      if (arguments_[0] === 'g') {
        writeGenerated(true)
      }
    })
  })

  it('installs the plugin, then asks for a binary by name, with no directory since the plugin places it by layout', async () => {
    await runAdd('rust-app', 'hello', {})

    expect(mockRunNx).toHaveBeenNthCalledWith(1, ['add', '@monodon/rust'], workspaceRoot)
    expect(mockRunNx).toHaveBeenNthCalledWith(
      2,
      ['g', '@monodon/rust:binary', '--name=hello', '--tags=type:rust-app', '--no-interactive'],
      workspaceRoot,
    )
  })

  it('points the workspace layout at apps/ for the one generator call, and leaves nx.json as it was', async () => {
    const before = readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')

    await runAdd('rust-app', 'hello', {})

    expect(existsSync(join(workspaceRoot, 'apps/hello/Cargo.toml'))).toBe(true)
    expect(readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')).toBe(before)
  })

  it('restores nx.json even when the generator fails', async () => {
    const before = readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')
    mockRunNx.mockImplementation((arguments_: string[]) => {
      if (arguments_[0] === 'g') {
        throw new Error('generator failed')
      }
    })

    await expect(runAdd('rust-app', 'hello', {})).rejects.toThrow('generator failed')
    expect(readFileSync(join(workspaceRoot, 'nx.json'), 'utf8')).toBe(before)
  })

  it('writes a greeting slice behind a mod.rs barrel, and a main.rs that only wires', async () => {
    await runAdd('rust-app', 'hello', {})

    const src = join(workspaceRoot, 'apps/hello/src')
    for (const file of ['main.rs', 'greeting/mod.rs', 'greeting/greeting_contract.rs', 'greeting/greet_use_case.rs']) {
      expect(existsSync(join(src, file))).toBe(true)
    }
    expect(readFileSync(join(src, 'greeting/greet_use_case.rs'), 'utf8')).toContain('#[cfg(test)]')
    expect(readFileSync(join(src, 'main.rs'), 'utf8')).toContain('greeting::greet("hello")')
  })

  it('--empty is an entry point that does nothing', async () => {
    await runAdd('rust-app', 'hello', { empty: true })

    const src = join(workspaceRoot, 'apps/hello/src')
    expect(readFileSync(join(src, 'main.rs'), 'utf8')).toBe('fn main() {}\n')
    expect(existsSync(join(src, 'greeting'))).toBe(false)
  })

  it('checks formatting as well as clippy, type-checks, and zips the release binary', async () => {
    await runAdd('rust-app', 'hello', {})

    const { targets } = JSON.parse(readFileSync(join(workspaceRoot, 'apps/hello/project.json'), 'utf8'))
    expect(targets.lint.options.commands).toEqual([
      'cargo fmt -p hello --check',
      'cargo clippy -p hello --all-targets --target-dir dist/target/hello -- -D warnings',
    ])
    expect(targets.typecheck.options.command).toBe('cargo check -p hello --all-targets --target-dir dist/target/hello')
    expect(targets.package.options.commands[0]).toBe('cargo build --release -p hello --target-dir dist/target/hello')
    expect(targets.package.outputs).toEqual(['{workspaceRoot}/dist/drop/rust-app-hello.zip'])
    // The plugin's own targets stay.
    expect(targets.build.executor).toBe('@monodon/rust:build')
  })

  it('registers the per-project scripts, with run as start', async () => {
    await runAdd('rust-app', 'hello', {})

    const { scripts } = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(scripts['hello:qa']).toBe('nx run hello:lint && nx run hello:test')
    expect(scripts['hello:start']).toBe('nx run hello:run')
  })
})

describe('runAdd rust libraries', () => {
  it('puts a publishable library under packages/ and a private one under libs/, tagged by kind, with no package target', async () => {
    mockRunNx.mockImplementation((arguments_: string[]) => {
      if (arguments_[0] === 'g') {
        writeGenerated(false)
      }
    })
    await runAdd('rust-lib', 'hello', {})
    expect(existsSync(join(workspaceRoot, 'packages/hello/Cargo.toml'))).toBe(true)
    await runAdd('rust-internal-lib', 'hello', {})

    const generators = mockRunNx.mock.calls.map(call => call[0]).filter(call => call[0] === 'g')
    expect(generators[0]).toEqual(['g', '@monodon/rust:library', '--name=hello', '--tags=type:rust-lib', '--no-interactive'])
    expect(generators[1]).toEqual(['g', '@monodon/rust:library', '--name=hello', '--tags=type:rust-internal-lib', '--no-interactive'])
    const { targets } = JSON.parse(readFileSync(join(workspaceRoot, 'libs/hello/project.json'), 'utf8'))
    expect(targets.package).toBeUndefined()
    expect(readFileSync(join(workspaceRoot, 'libs/hello/src/lib.rs'), 'utf8')).toContain('pub use greeting::{greet, Greeting};')
  })
})
