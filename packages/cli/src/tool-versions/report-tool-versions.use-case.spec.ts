// Reached through the overlay barrel (the pinned versions), which loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))
jest.mock('../terminal', () => ({
  logger: { step: jest.fn(), info: jest.fn(), success: jest.fn(), warn: jest.fn(), error: jest.fn(), detail: jest.fn() },
}))

import { logger } from '../terminal'
import { DOTNET_SDK_VERSION, FLUTTER_SDK_VERSION, GOLANGCI_LINT_VERSION, GO_VERSION, NODE_VERSION, NPM_VERSION } from '../workspace-overlay'
import type { ToolQueryDependencies } from './latest-tool-versions.client'
import { checkToolVersions, reportToolVersions } from './report-tool-versions.use-case'

const mockInfo = jest.mocked(logger.info)
const mockSuccess = jest.mocked(logger.success)

/** Release sources that answer with the given versions; any tool not named is unreachable. */
function sources (answers: { linter?: string, node?: string, npm?: string, go?: string, dotnet?: string, flutter?: string }): ToolQueryDependencies {
  return {
    fetchText: async url => {
      if (url.includes('nodejs.org') && answers.node !== undefined) {
        return JSON.stringify([{ version: 'v25.1.0', lts: false }, { version: `v${answers.node}`, lts: 'Krypton' }, { version: 'v22.9.0', lts: 'Jod' }])
      }
      if (url.includes('go.dev') && answers.go !== undefined) {
        return JSON.stringify([{ version: 'go1.99rc1', stable: false }, { version: `go${answers.go}`, stable: true }])
      }
      if (url.includes('dotnet') && answers.dotnet !== undefined) {
        return JSON.stringify({ 'releases-index': [{ 'channel-version': '11.0', 'support-phase': 'preview' }, { 'channel-version': answers.dotnet, 'support-phase': 'active' }, { 'channel-version': '8.0', 'support-phase': 'maintenance' }] })
      }

      return undefined
    },
    capture: async (command, arguments_) => {
      if (command === 'go' && answers.linter !== undefined) {
        return JSON.stringify({ Path: arguments_.at(-1), Version: `v${answers.linter}` })
      }
      if (command === 'npm' && answers.npm !== undefined) {
        return `${answers.npm}\n`
      }
      if (command === 'git' && answers.flutter !== undefined) {
        return ['aaa\trefs/tags/3.0.0', `bbb\trefs/tags/${answers.flutter}`, 'ccc\trefs/tags/3.9.9', 'ddd\trefs/tags/v1.2.3-pre', 'eee\trefs/tags/dev'].join('\n')
      }

      return undefined
    },
  }
}

const AT_PINS = { linter: GOLANGCI_LINT_VERSION, node: `${NODE_VERSION}.2.0`, npm: `${NPM_VERSION}.4.0`, go: `${GO_VERSION}.3`, dotnet: DOTNET_SDK_VERSION.replace(/\.x$/u, ''), flutter: FLUTTER_SDK_VERSION }

/** A source that throws instead of answering. */
async function fail (): Promise<string | undefined> {
  throw new Error('boom')
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('checkToolVersions', () => {
  it('finds nothing newer when every source reports the pinned release or an older patch of it', async () => {
    const statuses = await checkToolVersions(sources(AT_PINS))

    expect(statuses.map(status => status.name)).toEqual(['golangci-lint', 'Node', 'npm', 'Go', '.NET SDK', 'Flutter SDK'])
    expect(statuses.every(status => status.latest !== undefined)).toBe(true)
    expect(statuses.filter(status => status.newer)).toEqual([])
  })

  it('flags each tool whose source reports a release newer at the precision of its pin', async () => {
    const statuses = await checkToolVersions(sources({
      linter:  '99.0.0',
      node:    '99.0.0',
      npm:     '99.0.0',
      go:      '99.0.0',
      dotnet:  '99.0',
      flutter: '99.0.0',
    }))

    expect(statuses.filter(status => status.newer).map(status => status.name)).toEqual(['golangci-lint', 'Node', 'npm', 'Go', '.NET SDK', 'Flutter SDK'])
    expect(statuses.find(status => status.name === 'Flutter SDK')?.latest).toBe('99.0.0')
  })

  it('reads the newest long-term-support Node, the newest stable Go, and the newest supported .NET channel', async () => {
    const statuses = await checkToolVersions(sources({ ...AT_PINS, node: '40.1.0', go: '1.99.0', dotnet: '12.0' }))

    expect(statuses.find(status => status.name === 'Node')?.latest).toBe('40.1.0')
    expect(statuses.find(status => status.name === 'Go')?.latest).toBe('1.99.0')
    expect(statuses.find(status => status.name === '.NET SDK')?.latest).toBe('12.0')
  })

  it('leaves a tool without a latest, and not newer, when its source cannot be reached', async () => {
    const statuses = await checkToolVersions(sources({ node: '99.0.0' }))

    expect(statuses.find(status => status.name === 'Node')?.newer).toBe(true)
    expect(statuses.find(status => status.name === 'golangci-lint')).toMatchObject({ latest: undefined, newer: false })
  })

  it('survives a source that throws', async () => {
    const statuses = await checkToolVersions({ fetchText: fail, capture: fail })

    expect(statuses.every(status => status.latest === undefined && !status.newer)).toBe(true)
  })
})

describe('reportToolVersions', () => {
  it('lists the tools with a newer release and says the remedy is an mnci release', async () => {
    await reportToolVersions(sources({ ...AT_PINS, linter: '99.0.0' }))

    const lines = mockInfo.mock.calls.map(call => call[0])

    expect(lines.some(line => line.includes('golangci-lint') && line.includes(GOLANGCI_LINT_VERSION) && line.includes('99.0.0'))).toBe(true)
    expect(lines.some(line => line.includes('remedy is an mnci release'))).toBe(true)
    expect(mockSuccess).not.toHaveBeenCalled()
  })

  it('says everything is current when nothing is newer', async () => {
    await reportToolVersions(sources(AT_PINS))

    expect(mockSuccess).toHaveBeenCalledWith('Every tool mnci pins is on its latest release.')
  })

  it('is skipped loudly, not failed, when no source can be reached', async () => {
    await reportToolVersions(sources({}))

    expect(mockInfo.mock.calls.map(call => call[0]).join(' ')).toContain('SKIPPED tooling')
    expect(mockSuccess).not.toHaveBeenCalled()
  })
})
