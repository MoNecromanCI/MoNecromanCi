import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_NATIVE_RUNNERS } from './native-build.contract'
import { readNativeBuildConfig } from './read-native-build-config.use-case'

let workspaceRoot: string

/** Writes an `nx.json` whose `mnci.native` entry is `native`. */
function seed (native: unknown): void {
  writeFileSync(join(workspaceRoot, 'nx.json'), JSON.stringify({ mnci: { native } }))
}

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'mnci-native-config-'))
})

afterEach(() => {
  rmSync(workspaceRoot, { force: true, recursive: true })
})

describe('readNativeBuildConfig', () => {
  it('gives the defaults when there is no nx.json, or no native entry', () => {
    expect(readNativeBuildConfig(workspaceRoot)).toEqual({
      config:   { linuxPackages: [], runners: [...DEFAULT_NATIVE_RUNNERS] },
      problems: [],
    })

    writeFileSync(join(workspaceRoot, 'nx.json'), JSON.stringify({ mnci: {} }))

    expect(readNativeBuildConfig(workspaceRoot).problems).toEqual([])
  })

  it('reads the packages and the runners', () => {
    seed({ linuxPackages: ['libgtk-3-dev'], runners: ['ubuntu-24.04', 'macos-14'] })

    expect(readNativeBuildConfig(workspaceRoot).config).toEqual({
      linuxPackages: ['libgtk-3-dev'],
      runners:       ['ubuntu-24.04', 'macos-14'],
    })
  })

  it('keeps the default runners when the list is empty', () => {
    seed({ runners: [] })

    expect(readNativeBuildConfig(workspaceRoot).config.runners).toEqual([...DEFAULT_NATIVE_RUNNERS])
  })

  it('drops and reports entries that are not valid names', () => {
    seed({ linuxPackages: ['libgtk-3-dev', '-o Foo=bar', 'a b', 3], runners: ['ubuntu latest'] })

    const { config, problems } = readNativeBuildConfig(workspaceRoot)

    expect(config.linuxPackages).toEqual(['libgtk-3-dev'])
    expect(config.runners).toEqual([...DEFAULT_NATIVE_RUNNERS])
    expect(problems).toHaveLength(4)
    expect(problems[0]).toContain('mnci.native.linuxPackages has an invalid entry')
  })

  it('reports a value of the wrong shape and falls back to the defaults', () => {
    seed({ linuxPackages: 'libgtk-3-dev' })

    expect(readNativeBuildConfig(workspaceRoot).problems).toEqual(['mnci.native.linuxPackages must be a list of strings'])

    seed(['libgtk-3-dev'])

    expect(readNativeBuildConfig(workspaceRoot).problems).toEqual(['mnci.native must be an object'])
  })

  it('reads an nx.json that is not JSON as the defaults', () => {
    writeFileSync(join(workspaceRoot, 'nx.json'), '{ not json')

    expect(readNativeBuildConfig(workspaceRoot).problems).toEqual([])
  })
})
