// Mocked because this spec reaches sibling slices through their barrels, which transitively load
// @inquirer/prompts: ESM-only, and unparseable by jest as CJS. Nothing here exercises a prompt.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locateStrandedReleaseTags } from '../workspace-diagnostics'
import { createBaselineTags } from './create-baseline-tags.use-case'

let root: string

function git (...arguments_: string[]): string {
  return spawnSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...arguments_], { cwd: root, encoding: 'utf8' }).stdout.trim()
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-baseline-'))
  git('init', '-q')
  writeFileSync(join(root, 'f.txt'), '1')
  git('add', '.')
  git('commit', '-q', '-m', 'one')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('createBaselineTags', () => {
  it('tags the commit of the old tag under the new name, once, and never moves a tag', () => {
    const released = git('rev-parse', 'HEAD')
    git('tag', 'mysql@1.12.11')
    writeFileSync(join(root, 'f.txt'), '2')
    git('commit', '-qam', 'two')
    const stranded = [{ project: '@auto/mysql', oldTag: 'mysql@1.12.11', newTag: '@auto/mysql@1.12.11' }]

    expect(createBaselineTags(root, stranded)).toEqual({ created: ['@auto/mysql@1.12.11'], existing: [], failed: [] })
    expect(git('rev-parse', '@auto/mysql@1.12.11^{commit}')).toBe(released)
    expect(createBaselineTags(root, stranded)).toEqual({ created: [], existing: ['@auto/mysql@1.12.11'], failed: [] })
  })

  it('reports a tag git refuses, when the old tag does not resolve', () => {
    expect(createBaselineTags(root, [{ project: '@a/x', oldTag: 'x@9.9.9', newTag: '@a/x@9.9.9' }]).failed).toEqual(['@a/x@9.9.9'])
  })

  it('leaves nothing stranded once the baseline exists, even after a low tag was made under the new name', () => {
    mkdirSync(join(root, 'packages', 'ms.teams'), { recursive: true })
    writeFileSync(join(root, 'packages', 'ms.teams', 'package.json'), JSON.stringify({ name: '@auto/ms.teams' }))
    git('tag', 'ms.teams@1.12.11')
    git('tag', '@auto/ms.teams@0.0.5')
    const stranded = locateStrandedReleaseTags(root)

    expect(stranded.map(entry => entry.newTag)).toEqual(['@auto/ms.teams@1.12.11'])

    createBaselineTags(root, stranded)

    expect(locateStrandedReleaseTags(root)).toEqual([])
  })
})
