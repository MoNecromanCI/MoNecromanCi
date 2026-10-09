import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkTagsMatchRegistry } from './check-tags-match-registry.use-case'

jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

describe('checkTagsMatchRegistry', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mnci-tags-registry-'))
    mkdirSync(join(root, 'packages', 'core'), { recursive: true })
    writeFileSync(join(root, 'packages', 'core', 'package.json'), JSON.stringify({ name: '@scope/core', version: '0.0.1' }))
    execFileSync('git', ['init', '-q'], { cwd: root })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('fails when the registry holds a version above the newest tag, and says which tag to make', () => {
    execFileSync('git', ['tag', '@scope/core@1.2.0'], { cwd: root })

    const finding = checkTagsMatchRegistry(root, () => new Map([['@scope/core', '1.2.1']]))

    expect(finding.ok).toBe(false)
    expect(finding.detail).toContain('@scope/core is tagged 1.2.0 but the registry holds 1.2.1')
    expect(finding.remedy).toContain('git tag @scope/core@1.2.1')
  })

  it('passes when the tag is level with the registry, or the registry does not know the package', () => {
    execFileSync('git', ['tag', '@scope/core@1.2.0'], { cwd: root })

    expect(checkTagsMatchRegistry(root, () => new Map([['@scope/core', '1.2.0']])).ok).toBe(true)
    expect(checkTagsMatchRegistry(root, () => new Map()).ok).toBe(true)
  })

  it('asks the registry for nothing in a workspace that has no tag yet', () => {
    const lookup = jest.fn(() => new Map<string, string>())

    expect(checkTagsMatchRegistry(root, lookup).ok).toBe(true)
    expect(lookup).not.toHaveBeenCalled()
  })
})
