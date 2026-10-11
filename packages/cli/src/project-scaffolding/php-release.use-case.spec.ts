jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))

import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { COMPOSER_VERSION_ACTIONS, phpLibPublishTarget } from './php-release.use-case'

/** A library's composer.json, indented with four spaces as Composer writes it. */
function manifest (version: string): string {
  return `${JSON.stringify({
    name:    'acme/core',
    type:    'library',
    require: { 'acme/kit': '^0.1' },
    extra:   { mnci: { version } },
  }, undefined, 4)}\n`
}

describe('COMPOSER_VERSION_ACTIONS', () => {
  it('is a CommonJS module that parses, and reads and writes extra.mnci.version without touching a requirement', async () => {
    const exported: { exports: unknown } = { exports: undefined }
    const nodeRequire = createRequire(__filename)
    const stubbedRequire = (name: string): unknown => (name === 'nx/release' ? { VersionActions: class {} } : nodeRequire(name))
    runInNewContext(COMPOSER_VERSION_ACTIONS, { require: stubbedRequire, module: exported })
    const Actions = exported.exports as new () => {
      projectGraphNode:                     { data: { root: string }, name: string }
      readCurrentVersionFromSourceManifest: (tree: unknown) => Promise<{ currentVersion: string } | null>
      updateProjectVersion:                 (tree: unknown, version: string) => Promise<string[]>
    }
    const actions = new Actions()
    actions.projectGraphNode = { data: { root: 'packages/core' }, name: 'core' }
    const files = new Map([['packages/core/composer.json', manifest('0.1.0')]])
    const tree = {
      exists: (path: string) => files.has(path),
      read:   (path: string) => files.get(path),
      write:  (path: string, contents: string) => { files.set(path, contents) },
    }

    const read = await actions.readCurrentVersionFromSourceManifest(tree)
    await actions.updateProjectVersion(tree, '0.2.0')

    expect(read?.currentVersion).toBe('0.1.0')
    expect(files.get('packages/core/composer.json')).toBe(manifest('0.2.0'))
  })
})

describe('phpLibPublishTarget', () => {
  it('is always present and says Packagist reads the tag', () => {
    const { command } = phpLibPublishTarget('core').options as { command: string }

    expect(command).toContain('PHP library core is released by its git tag')
  })
})
