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

    expect(readWorkspaceInstall(root)).toEqual({ declared: '^4.100.0', installed: '4.100.0', locked: undefined })
  })

  it('finds a runtime dependency too', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@mnci/cli': '4.1.0' } }))

    expect(readWorkspaceInstall(root)).toEqual({ declared: '4.1.0', installed: undefined, locked: undefined })
  })

  it('answers nothing for a workspace with no manifest or no install', () => {
    expect(readWorkspaceInstall(root)).toEqual({ declared: undefined, installed: undefined, locked: undefined })
  })

  it('answers nothing for a manifest that is not JSON', () => {
    writeFileSync(join(root, 'package.json'), '{ nope')

    expect(readWorkspaceInstall(root)).toEqual({ declared: undefined, installed: undefined, locked: undefined })
  })
})

describe('readWorkspaceInstall, the lockfile', () => {
  it('reads the pinned version of a lockfile v2 or v3 when node_modules is not restored', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { '@mnci/cli': '^4.100.0' } }))
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/@mnci/cli': { version: '4.99.0' } } }))

    expect(readWorkspaceInstall(root)).toEqual({ declared: '^4.100.0', installed: undefined, locked: '4.99.0' })
  })

  it('reads the pinned version of a lockfile v1', () => {
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 1, dependencies: { '@mnci/cli': { version: '4.50.0' } } }))

    expect(readWorkspaceInstall(root).locked).toBe('4.50.0')
  })
})
