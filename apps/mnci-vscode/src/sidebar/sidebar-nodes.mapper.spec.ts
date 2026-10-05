import type { CommandDescription, WorkspaceInfo } from '../cli-contracts'
import { commandNodes, projectNodes, summarise, updateNodes } from './sidebar-nodes.mapper'

/** A command with just a name, group and description. */
function command (name: string, group: CommandDescription['group'], description = `${name} does a thing. More detail.`): CommandDescription {
  return { name, aliases: [], group, description, arguments: [], options: [] }
}

describe('summarise', () => {
  it.each([
    ['Create a new monorepo (Nx preset)', 'Create a new monorepo (Nx preset)'],
    ['Check this workspace. Read-only; exits non-zero.', 'Check this workspace'],
    ['Show every dependency — grouped by kind', 'Show every dependency'],
    ['Add a dependency to a specific project using its own toolchain (npm/pip/pub/nuget/go), or with no package install everything', 'Add a dependency to a specific project using its own tool…'],
  ])('shortens %j', (input, expected) => {
    expect(summarise(input)).toBe(expected)
  })
})

describe('commandNodes', () => {
  const nodes = commandNodes([command('add', 'projects'), command('new', 'workspace'), command('doctor', 'workspace'), command('info', 'inspect'), command('up', 'dependencies')])

  it('lists one heading per group with commands, in a fixed order', () => {
    expect(nodes.map(node => node.label)).toEqual(['Workspace', 'Projects', 'Dependencies'])
  })

  it('leaves out the commands that only describe the CLI, and the groups that would be empty', () => {
    const labels = nodes.flatMap(node => node.children ?? []).map(child => child.label)

    expect(labels).not.toContain('info')
    expect(nodes.map(node => node.label)).not.toContain('Pipeline')
  })

  it('runs the extension command named after the CLI command, and keeps the full text as the tooltip', () => {
    const add = nodes[1].children?.[0]

    expect(add).toMatchObject({ label: 'add', command: { id: 'mnci.add' }, tooltip: 'add does a thing. More detail.', description: 'add does a thing' })
  })
})

describe('projectNodes', () => {
  const nodes = projectNodes([{ name: 'api', dir: 'apps/api', ecosystem: 'go', kind: 'go-app', targets: ['build', 'test'] }])

  it('describes a project by directory, ecosystem and kind', () => {
    expect(nodes[0]).toMatchObject({ label: 'api', description: 'apps/api · go · go-app', contextValue: 'mnci.project' })
  })

  it('lists its targets, each running the target on click', () => {
    expect(nodes[0].children).toEqual([
      expect.objectContaining({ label: 'build', command: { id: 'mnci.runTarget', arguments_: ['api', 'build'] } }),
      expect.objectContaining({ label: 'test', command: { id: 'mnci.runTarget', arguments_: ['api', 'test'] } }),
    ])
  })

  it('omits the kind when mnci recorded none', () => {
    expect(projectNodes([{ name: 'lib', dir: 'packages/lib', ecosystem: 'npm', targets: [] }])[0].description).toBe('packages/lib · npm')
  })
})

/** A workspace report whose CLI half is the given overrides. */
function info (overrides: Partial<WorkspaceInfo['cli']>, workspace: WorkspaceInfo['workspace'] = null): WorkspaceInfo {
  return { cli: { version: '1.2.0', latest: '1.2.0', updateAvailable: false, ...overrides }, workspace }
}

describe('updateNodes', () => {
  it('shows the installed version and where it came from', () => {
    expect(updateNodes(info({}), { command: 'mnci', prefix: [], source: 'workspace' })[0]).toMatchObject({ label: 'mnci 1.2.0', description: "this workspace's own install" })
  })

  it('offers the update, running mnci.updateCli, when a newer one exists', () => {
    expect(updateNodes(info({ latest: '2.0.0', updateAvailable: true }), { command: 'mnci', prefix: [], source: 'path' })[1]).toMatchObject({ label: 'Update to 2.0.0', command: { id: 'mnci.updateCli' } })
  })

  it('says so, with no action, when up to date', () => {
    const row = updateNodes(info({}), { command: 'mnci', prefix: [], source: 'path' })[1]

    expect(row).toMatchObject({ label: 'Up to date', description: '1.2.0' })
    expect(row.command).toBeUndefined()
  })

  it('says the latest is unknown when the registry did not answer', () => {
    expect(updateNodes(info({ latest: null }), { command: 'mnci', prefix: [], source: 'path' })[1].description).toMatch(/unknown/)
  })

  it('shows the workspace root, with its settings as the tooltip, or that none is open', () => {
    const open = updateNodes(info({}, { root: '/ws', config: { ci: 'github' } }), { command: 'mnci', prefix: [], source: 'path' })[2]
    const none = updateNodes(info({}), { command: 'mnci', prefix: [], source: 'path' })[2]

    expect(open).toMatchObject({ description: '/ws', tooltip: expect.stringContaining('github') })
    expect(none.description).toBe('none open')
  })
})
