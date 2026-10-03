import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { declareSidecarDependencies, findVscodeSidecars } from './vscode-sidecar.use-case'

let workspaceRoot: string

const PACKAGE_COMMAND = 'node tools/vscode-extension.cjs package apps/ext --sidecar engine'

/** Writes an extension's `package.json` under `apps/<directory>`, as `mnci add vscode-extension` leaves it. */
function extension (directory: string, nx: Record<string, unknown>, name = directory): void {
  mkdirSync(join(workspaceRoot, 'apps', directory), { recursive: true })
  writeFileSync(join(workspaceRoot, 'apps', directory, 'package.json'), JSON.stringify({ name, nx }))
}

/** An `nx` block with the extension tag and a `package` target that names its sidecar. */
function withSidecar (extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name:    'ext',
    tags:    ['type:vscode-extension'],
    targets: { package: { options: { command: PACKAGE_COMMAND } } },
    ...extra,
  }
}

/** Reads an extension's `nx` block back. */
function nxOf (directory: string): { implicitDependencies?: string[]; [key: string]: unknown } {
  return (JSON.parse(readFileSync(join(workspaceRoot, 'apps', directory, 'package.json'), 'utf8')) as { nx: ReturnType<typeof nxOf> }).nx
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-sidecar-'))
})

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

describe('findVscodeSidecars', () => {
  it('reads the sidecar from the package target, which is where --sidecar is recorded', () => {
    extension('ext', withSidecar())

    expect(findVscodeSidecars(workspaceRoot)).toEqual([
      { manifestPath: 'apps/ext/package.json', extension: 'ext', sidecar: 'engine', declared: false },
    ])
  })

  it('reports an extension that already depends on its sidecar as declared', () => {
    extension('ext', withSidecar({ implicitDependencies: ['engine'] }))

    expect(findVscodeSidecars(workspaceRoot)[0].declared).toBe(true)
  })

  it('does not count a different implicit dependency as the sidecar', () => {
    extension('ext', withSidecar({ implicitDependencies: ['something-else'] }))

    expect(findVscodeSidecars(workspaceRoot)[0].declared).toBe(false)
  })

  it('finds nothing for an extension that ships no sidecar, and nothing for a project that is not an extension', () => {
    extension('plain', { name: 'plain', tags: ['type:vscode-extension'], targets: { package: { options: { command: 'node tools/vscode-extension.cjs package apps/plain' } } } })
    extension('lookalike', { name: 'lookalike', tags: ['type:node-app'], targets: { package: { options: { command: PACKAGE_COMMAND } } } })

    expect(findVscodeSidecars(workspaceRoot)).toEqual([])
  })

  it('uses the Nx project name, not the package name, which can differ from the folder', () => {
    extension('ext', withSidecar({ name: 'pinned-name' }), '@scope/ext')

    expect(findVscodeSidecars(workspaceRoot)[0].extension).toBe('pinned-name')
  })

  it('finds every extension in the workspace', () => {
    extension('one', withSidecar({ name: 'one' }))
    extension('two', withSidecar({ name: 'two', implicitDependencies: ['engine'] }))

    expect(findVscodeSidecars(workspaceRoot).map(({ extension: name, declared }) => [name, declared])).toEqual([['one', false], ['two', true]])
  })

  it('is empty with no apps folder', () => {
    expect(findVscodeSidecars(workspaceRoot)).toEqual([])
  })
})

describe('declareSidecarDependencies', () => {
  it('makes the extension depend on its sidecar, and says which file it changed', () => {
    extension('ext', withSidecar())

    expect(declareSidecarDependencies(workspaceRoot)).toEqual(['apps/ext/package.json'])
    expect(nxOf('ext').implicitDependencies).toEqual(['engine'])
  })

  it('keeps another implicit dependency and the rest of the nx block', () => {
    extension('ext', withSidecar({ implicitDependencies: ['shared-config'] }))

    declareSidecarDependencies(workspaceRoot)

    expect(nxOf('ext').implicitDependencies).toEqual(['shared-config', 'engine'])
    expect(nxOf('ext').tags).toEqual(['type:vscode-extension'])
    expect(nxOf('ext').targets).toEqual({ package: { options: { command: PACKAGE_COMMAND } } })
  })

  it('is idempotent: a second call changes nothing and reports nothing', () => {
    extension('ext', withSidecar())

    declareSidecarDependencies(workspaceRoot)
    const once = readFileSync(join(workspaceRoot, 'apps/ext/package.json'), 'utf8')

    expect(declareSidecarDependencies(workspaceRoot)).toEqual([])
    expect(readFileSync(join(workspaceRoot, 'apps/ext/package.json'), 'utf8')).toBe(once)
  })

  it('leaves an extension without a sidecar untouched', () => {
    extension('plain', { name: 'plain', tags: ['type:vscode-extension'] })
    const before = readFileSync(join(workspaceRoot, 'apps/plain/package.json'), 'utf8')

    expect(declareSidecarDependencies(workspaceRoot)).toEqual([])
    expect(readFileSync(join(workspaceRoot, 'apps/plain/package.json'), 'utf8')).toBe(before)
  })

  it('repairs only the extensions that need it', () => {
    extension('one', withSidecar({ name: 'one' }))
    extension('two', withSidecar({ name: 'two', implicitDependencies: ['engine'] }))

    expect(declareSidecarDependencies(workspaceRoot)).toEqual(['apps/one/package.json'])
  })
})
