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
import { runNx, runShell } from '../nx-workspace'
import { runAdd } from './add-project.use-case'

const mockRunNx = jest.mocked(runNx)
const mockRunShell = jest.mocked(runShell)

let workspaceRoot: string

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-add-react-p5-'))
  mockRunShell.mockImplementation(() => 0)
  mockRunNx.mockImplementation((arguments_: string[]) => {
    if (arguments_[0] !== 'g') {
      return
    }
    mkdirSync(join(workspaceRoot, 'apps/sketchbook/src/app'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'apps/sketchbook/package.json'), JSON.stringify({ name: '@demo/sketchbook' }))
  })
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

describe('runAdd react-p5-app', () => {
  it('is the React app generator, then p5 and its wrapper installed into the app and not the root', async () => {
    await runAdd('react-p5-app', 'sketchbook', {})

    expect(mockRunNx).toHaveBeenNthCalledWith(2, expect.arrayContaining(['g', '@nx/react:app', 'apps/sketchbook']), workspaceRoot)
    expect(mockRunShell).toHaveBeenCalledWith('npm', ['install'], workspaceRoot)
    expect(mockRunShell).toHaveBeenCalledWith('npm', ['install', '-w', 'apps/sketchbook', 'p5', '@p5-wrapper/react'], workspaceRoot)
  })

  it('writes the bouncing-ball slice with the pure motion apart from the p5 adapter, and composes it in App', async () => {
    await runAdd('react-p5-app', 'sketchbook', {})

    const src = join(workspaceRoot, 'apps/sketchbook/src')
    for (const file of [
      'bouncing-ball/ball.contract.ts',
      'bouncing-ball/step-ball.algorithm.ts',
      'bouncing-ball/step-ball.algorithm.spec.ts',
      'bouncing-ball/bouncing-ball.client.ts',
      'bouncing-ball/bouncing-ball.client.spec.ts',
      'bouncing-ball/bouncing-ball.component.tsx',
      'bouncing-ball/index.ts',
      'greeting/greeting.contract.ts',
    ]) {
      expect(existsSync(join(src, file))).toBe(true)
    }
    expect(readFileSync(join(src, 'bouncing-ball/step-ball.algorithm.ts'), 'utf8')).not.toContain('p5')
    expect(readFileSync(join(src, 'bouncing-ball/bouncing-ball.client.ts'), 'utf8')).toContain("from '@p5-wrapper/react'")
    expect(readFileSync(join(src, 'app/app.component.tsx'), 'utf8')).toContain("from '../bouncing-ball'")
  })

  it('--empty still installs the packages but writes no sketch', async () => {
    await runAdd('react-p5-app', 'sketchbook', { empty: true })

    expect(mockRunShell).toHaveBeenCalledWith('npm', ['install', '-w', 'apps/sketchbook', 'p5', '@p5-wrapper/react'], workspaceRoot)
    expect(existsSync(join(workspaceRoot, 'apps/sketchbook/src/bouncing-ball'))).toBe(false)
  })

  it('refuses --e2e on other kinds but accepts it here', async () => {
    await expect(runAdd('react-p5-app', 'sketchbook', { e2e: true })).resolves.toBeUndefined()
  })
})
