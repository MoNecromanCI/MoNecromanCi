import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchLatestVersion } from '../cli-version'
import { readWorkspaceInfo } from './read-workspace-info.use-case'

// The prompts library ships ESM only, which Jest cannot load; nothing here prompts.
jest.mock('@inquirer/prompts', () => ({}))

jest.mock('../cli-version', () => ({
  fetchLatestVersion: jest.fn(),
  isNewerVersion:     jest.requireActual('../cli-version/check-for-update.use-case').isNewerVersion,
}))

const mockLatest = jest.mocked(fetchLatestVersion)
let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-info-'))
  mockLatest.mockReset()
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('readWorkspaceInfo', () => {
  it('flags an update when the registry has a newer version', () => {
    mockLatest.mockReturnValue('2.0.0')

    expect(readWorkspaceInfo(workspaceRoot, '1.9.0').cli).toEqual({ version: '1.9.0', latest: '2.0.0', updateAvailable: true })
  })

  it('reports no update when the versions match', () => {
    mockLatest.mockReturnValue('1.9.0')

    expect(readWorkspaceInfo(workspaceRoot, '1.9.0').cli.updateAvailable).toBe(false)
  })

  it('leaves latest null, and never fails, when the registry does not answer', () => {
    mockLatest.mockReturnValue(undefined)

    expect(readWorkspaceInfo(workspaceRoot, '1.9.0').cli).toEqual({ version: '1.9.0', latest: null, updateAvailable: false })
  })

  it('has no workspace half outside a workspace', () => {
    mockLatest.mockReturnValue(undefined)

    expect(readWorkspaceInfo(workspaceRoot, '1.0.0').workspace).toBeNull()
  })

  it('reports the recorded mnci settings inside a workspace', () => {
    mockLatest.mockReturnValue(undefined)
    writeFileSync(join(workspaceRoot, 'nx.json'), JSON.stringify({ mnci: { ci: 'github', scope: '@demo' } }))

    expect(readWorkspaceInfo(workspaceRoot, '1.0.0').workspace).toEqual({
      root:   workspaceRoot,
      config: { ci: 'github', scope: '@demo' },
    })
  })
})
