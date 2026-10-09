jest.mock('../nx-workspace', () => ({ runShell: jest.fn() }))
jest.mock('../terminal', () => ({ logger: { step: jest.fn(), detail: jest.fn(), warn: jest.fn() } }))

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runShell } from '../nx-workspace'
import { migrateNx } from './migrate-nx.use-case'

const mockRunShell = jest.mocked(runShell)
let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-migrate-'))
  mockRunShell.mockReset()
  mockRunShell.mockReturnValue(0)
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

const commands = (): string[] => mockRunShell.mock.calls.map(([command, arguments_]) => [command, ...arguments_].join(' '))

describe('migrateNx (#312)', () => {
  it('stops after the migrate when Nx is already current', () => {
    expect(migrateNx(workspaceRoot)).toBe(true)
    expect(commands()).toEqual(['npx nx migrate latest'])
  })

  it('installs and runs the migrations when migrate wrote them', () => {
    mockRunShell.mockImplementation((command, arguments_) => {
      if (arguments_.includes('latest')) {
        writeFileSync(join(workspaceRoot, 'migrations.json'), '{}')
      }

      return command === 'never' ? 1 : 0
    })

    expect(migrateNx(workspaceRoot)).toBe(true)
    expect(commands()).toEqual(['npx nx migrate latest', 'npm install', 'npx nx migrate --run-migrations'])
  })

  it('stops at the first failing step', () => {
    mockRunShell.mockReturnValue(1)

    expect(migrateNx(workspaceRoot)).toBe(false)
    expect(commands()).toEqual(['npx nx migrate latest'])
  })
})
