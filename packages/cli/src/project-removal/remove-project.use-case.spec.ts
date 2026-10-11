jest.mock('../nx-workspace', () => ({ runShell: jest.fn(() => 0), runCapture: jest.fn(() => ({ status: 1, stdout: '' })) }))
jest.mock('../lockfile-completion', () => ({ completeLockfile: jest.fn() }))
jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn(), confirm: jest.fn() }))
jest.mock('../terminal', () => ({
  logger:        { info: jest.fn(), step: jest.fn(), success: jest.fn(), warn: jest.fn(), error: jest.fn() },
  promptConfirm: jest.fn(async () => true),
}))

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runCapture, runShell } from '../nx-workspace'
import { logger, promptConfirm } from '../terminal'
import { runRemove } from './remove-project.use-case'

const mockRunCapture = jest.mocked(runCapture)
const mockRunShell = jest.mocked(runShell)

let root: string

/** Writes a file and the directories above it. */
function seed (relativePath: string, content: string): void {
  const full = join(root, relativePath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

function read (relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-remove-'))
  jest.clearAllMocks()
  process.exitCode = 0
  mockRunCapture.mockReturnValue({ status: 1, stdout: '' })
  seed('nx.json', '{}')
  seed('package.json', JSON.stringify({ name: 'root', private: true, scripts: { 'web:qa': 'a', 'web:build': 'b', 'api:qa': 'c', 'format': 'd' } }))
  seed('apps/web/package.json', JSON.stringify({ name: '@x/web' }))
  seed('apps/web-e2e/package.json', JSON.stringify({ name: '@x/web-e2e' }))
  seed('apps/api/go.mod', 'module x/api\n\ngo 1.27\n')
  seed('go.work', 'go 1.27\n\nuse (\n\t./apps/api\n)\n')
  seed('tsconfig.base.json', JSON.stringify({ compilerOptions: { paths: { '@x/web': ['apps/web/src/index.ts'], '@x/other': ['libs/other/src/index.ts'] } } }))
  seed('demo.code-workspace', JSON.stringify({
    folders: [{ name: 'demo', path: '.' }],
    launch:  { version: '0.2.0', configurations: [{ name: 'mnci: web qa' }, { name: 'mnci: web build' }, { name: 'mnci: api qa' }] },
  }))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  process.exitCode = 0
})

describe('runRemove', () => {
  it('shows the plan and changes nothing on a dry run', async () => {
    await runRemove(root, 'web', { dryRun: true })

    expect(existsSync(join(root, 'apps/web'))).toBe(true)
    expect(read('package.json')).toContain('web:qa')
    expect(logger.info).toHaveBeenCalledWith('  delete apps/web/')
  })

  it('deletes the folder and its paired e2e project, and drops its scripts, launch configurations and alias, and nothing else', async () => {
    await runRemove(root, 'web', { yes: true })

    expect(existsSync(join(root, 'apps/web'))).toBe(false)
    expect(existsSync(join(root, 'apps/web-e2e'))).toBe(false)
    expect(existsSync(join(root, 'apps/api'))).toBe(true)
    expect(JSON.parse(read('package.json')).scripts).toEqual({ 'api:qa': 'c', 'format': 'd' })
    expect(JSON.parse(read('demo.code-workspace')).launch.configurations).toEqual([{ name: 'mnci: api qa' }])
    expect(JSON.parse(read('tsconfig.base.json')).compilerOptions.paths).toEqual({ '@x/other': ['libs/other/src/index.ts'] })
  })

  it('takes a Go module out of go.work and syncs the workspace', async () => {
    await runRemove(root, 'apps/api', { yes: true })

    expect(read('go.work')).not.toContain('apps/api')
    expect(mockRunShell).toHaveBeenCalledWith('go', ['work', 'sync'], root)
  })

  it('refuses while another project depends on it, unless forced', async () => {
    mockRunCapture.mockImplementation((_command, arguments_) => {
      const file = String(arguments_.find(argument => argument.startsWith('--file='))).slice('--file='.length)
      writeFileSync(file, JSON.stringify({
        graph: {
          nodes:        { '@x/web': { data: { root: 'apps/web' } }, '@x/shop': { data: { root: 'apps/shop' } } },
          dependencies: { '@x/shop': [{ target: '@x/web' }], '@x/web': [] },
        },
      }))

      return { status: 0, stdout: '' }
    })

    await runRemove(root, 'web', { yes: true })
    expect(existsSync(join(root, 'apps/web'))).toBe(true)
    expect(process.exitCode).toBe(1)

    process.exitCode = 0
    await runRemove(root, 'web', { yes: true, force: true })
    expect(existsSync(join(root, 'apps/web'))).toBe(false)
  })

  it('asks first, and does nothing when the answer is no', async () => {
    jest.mocked(promptConfirm).mockResolvedValueOnce(false)
    const original = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    try {
      await runRemove(root, 'web', {})
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: original, configurable: true })
    }

    expect(existsSync(join(root, 'apps/web'))).toBe(true)
  })

  it('refuses to apply with no terminal and no --yes', async () => {
    const original = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    try {
      await runRemove(root, 'web', {})
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: original, configurable: true })
    }

    expect(existsSync(join(root, 'apps/web'))).toBe(true)
    expect(process.exitCode).toBe(1)
  })

  it('names an unknown project and fails', async () => {
    await runRemove(root, 'nope', { yes: true })

    expect(process.exitCode).toBe(1)
  })
})
