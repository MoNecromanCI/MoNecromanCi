jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))

import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { RUBY_VERSION_ACTIONS, rubyLibPublishTarget } from './ruby-release.use-case'

/** A `version.rb` at a version, beside a gemspec-style constant that must never be touched. */
function versionFile (version: string): string {
  return ['# frozen_string_literal: true', '', 'module Core', `  VERSION = '${version}'`, '  MIN_RUBY = \'3.3\'', 'end', ''].join('\n')
}

describe('RUBY_VERSION_ACTIONS', () => {
  it('is a CommonJS module that parses, and reads and writes only the VERSION constant of lib/<name>/version.rb', async () => {
    const exported: { exports: unknown } = { exports: undefined }
    const nodeRequire = createRequire(__filename)
    const stubbedRequire = (name: string): unknown => (name === 'nx/release' ? { VersionActions: class {} } : nodeRequire(name))
    runInNewContext(RUBY_VERSION_ACTIONS, { require: stubbedRequire, module: exported })
    const Actions = exported.exports as new () => {
      projectGraphNode:                     { data: { root: string }, name: string }
      readCurrentVersionFromSourceManifest: (tree: unknown) => Promise<{ currentVersion: string } | null>
      updateProjectVersion:                 (tree: unknown, version: string) => Promise<string[]>
    }
    const actions = new Actions()
    actions.projectGraphNode = { data: { root: 'packages/core' }, name: 'core' }
    const files = new Map([['packages/core/lib/core/version.rb', versionFile('0.1.0')]])
    const tree = {
      children: (path: string) => (path === 'packages/core/lib' ? ['core'] : []),
      exists:   (path: string) => files.has(path),
      read:     (path: string) => files.get(path),
      write:    (path: string, contents: string) => { files.set(path, contents) },
    }

    const read = await actions.readCurrentVersionFromSourceManifest(tree)
    await actions.updateProjectVersion(tree, '0.2.0')

    expect(read?.currentVersion).toBe('0.1.0')
    expect(files.get('packages/core/lib/core/version.rb')).toBe(versionFile('0.2.0'))
  })
})

describe('rubyLibPublishTarget', () => {
  it('is always present and says there is nothing to upload', () => {
    const { command } = rubyLibPublishTarget('core').options as { command: string }

    expect(command).toContain('Ruby gem core is released by its git tag')
  })
})
