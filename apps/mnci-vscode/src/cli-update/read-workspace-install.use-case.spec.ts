import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWorkspaceInstall } from './read-workspace-install.use-case'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-install-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('readWorkspaceInstall', () => {
  it('reads the declared range and the installed version', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { '@mnci/cli': '^4.100.0' } }))
    mkdirSync(join(root, 'node_modules/@mnci/cli'), { recursive: true })
    writeFileSync(join(root, 'node_modules/@mnci/cli/package.json'), JSON.stringify({ version: '4.100.0' }))

    expect(readWorkspaceInstall(root)).toEqual({ declared: '^4.100.0', installed: '4.100.0' })
  })

  it('finds a runtime dependency too', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@mnci/cli': '4.1.0' } }))

    expect(readWorkspaceInstall(root)).toEqual({ declared: '4.1.0', installed: undefined })
  })

  it('answers nothing for a workspace with no manifest or no install', () => {
    expect(readWorkspaceInstall(root)).toEqual({ declared: undefined, installed: undefined })
  })

  it('answers nothing for a manifest that is not JSON', () => {
    writeFileSync(join(root, 'package.json'), '{ nope')

    expect(readWorkspaceInstall(root)).toEqual({ declared: undefined, installed: undefined })
  })
})
