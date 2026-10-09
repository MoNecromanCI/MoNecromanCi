import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listGoModuleDirectories } from './list-go-modules.use-case'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-go-modules-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('listGoModuleDirectories', () => {
  it('lists the go.work use entries of a multi-module workspace, which has no root go.mod', () => {
    writeFileSync(join(root, 'go.work'), 'go 1.24\n\nuse (\n\t./apps/cli\n\t./libs/core\n)\n')

    expect(listGoModuleDirectories(root)).toEqual(['./apps/cli', './libs/core'])
  })

  it('is the root itself for an adopted flat repository', () => {
    writeFileSync(join(root, 'go.mod'), 'module flat\n\ngo 1.24\n')

    expect(listGoModuleDirectories(root)).toEqual(['.'])
  })

  it('prefers go.work when both exist', () => {
    writeFileSync(join(root, 'go.mod'), 'module flat\n')
    writeFileSync(join(root, 'go.work'), 'use ./apps/cli\n')

    expect(listGoModuleDirectories(root)).toEqual(['./apps/cli'])
  })

  it('is an empty list for a go.work with no modules, and undefined for no Go at all', () => {
    writeFileSync(join(root, 'go.work'), 'go 1.24\n')

    expect(listGoModuleDirectories(root)).toEqual([])

    rmSync(join(root, 'go.work'))

    expect(listGoModuleDirectories(root)).toBeUndefined()
  })
})
