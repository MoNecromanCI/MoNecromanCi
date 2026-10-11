jest.mock('@inquirer/prompts', () => ({ select: jest.fn(), input: jest.fn() }))

import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { javaLibPublishTarget, MAVEN_VERSION_ACTIONS } from './java-release.use-case'

/** A module pom with a parent (which has its own version) and a dependency (which has one too). */
function pom (version: string): string {
  return [
    '<project>',
    '  <parent>',
    '    <groupId>com.example</groupId>',
    '    <artifactId>workspace</artifactId>',
    '    <version>0.0.0</version>',
    '  </parent>',
    '  <artifactId>core</artifactId>',
    `  <version>${version}</version>`,
    '  <dependencies>',
    '    <dependency>',
    '      <artifactId>kit</artifactId>',
    '      <version>0.1.0</version>',
    '    </dependency>',
    '  </dependencies>',
    '</project>',
    '',
  ].join('\n')
}

describe('MAVEN_VERSION_ACTIONS', () => {
  it('is a CommonJS module that parses, and reads and writes the module version, not the parent or a dependency', async () => {
    const exported: { exports: unknown } = { exports: undefined }
    const nodeRequire = createRequire(__filename)
    const stubbedRequire = (name: string): unknown => (name === 'nx/release' ? { VersionActions: class {} } : nodeRequire(name))
    runInNewContext(MAVEN_VERSION_ACTIONS, { require: stubbedRequire, module: exported })
    const Actions = exported.exports as new () => {
      projectGraphNode:                     { data: { root: string }, name: string }
      readCurrentVersionFromSourceManifest: (tree: unknown) => Promise<{ currentVersion: string } | null>
      updateProjectVersion:                 (tree: unknown, version: string) => Promise<string[]>
    }
    const actions = new Actions()
    actions.projectGraphNode = { data: { root: 'packages/core' }, name: 'core' }
    const files = new Map([['packages/core/pom.xml', pom('0.1.0')]])
    const tree = {
      exists: (path: string) => files.has(path),
      read:   (path: string) => files.get(path),
      write:  (path: string, contents: string) => { files.set(path, contents) },
    }

    const read = await actions.readCurrentVersionFromSourceManifest(tree)
    await actions.updateProjectVersion(tree, '0.2.0')

    expect(read?.currentVersion).toBe('0.1.0')
    expect(files.get('packages/core/pom.xml')).toBe(pom('0.2.0'))
  })
})

describe('javaLibPublishTarget', () => {
  it('is always present and says there is nothing to upload', () => {
    const { command } = javaLibPublishTarget('core').options as { command: string }

    expect(command).toContain('Java library core is released by its git tag')
  })
})
