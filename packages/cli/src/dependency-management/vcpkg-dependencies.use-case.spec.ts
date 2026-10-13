// Reached through the barrel of a slice that loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))
jest.mock('../nx-workspace', () => ({ runShell: jest.fn() }))

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runShell } from '../nx-workspace'
import type { ProjectLocation } from './manifest.repository'
import { addVcpkgPorts, removeVcpkgPorts } from './vcpkg-dependencies.use-case'

const mockRunShell = jest.mocked(runShell)

const CMAKE = 'cmake_minimum_required(VERSION 3.20)\nproject(tool VERSION 0.1.0 LANGUAGES CXX)\nadd_executable(tool src/main.cpp)\n'
const USAGE = 'The package fmt provides CMake targets:\n\n    find_package(fmt CONFIG REQUIRED)\n    target_link_libraries(main PRIVATE fmt::fmt)\n'

let workspace: string
let vcpkgRoot: string
let location: ProjectLocation
let savedRoot: string | undefined

/**
 * Reads the ports the tool project's vcpkg.json depends on.
 *
 * @returns The `dependencies` array.
 */
function manifestPorts (): unknown {
  const manifest = JSON.parse(readFileSync(join(workspace, 'apps/tool/vcpkg.json'), 'utf8')) as { dependencies: unknown }

  return manifest.dependencies
}

/** Writes a file, creating its folder. */
function write (path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'mnci-vcpkg-'))
  vcpkgRoot = mkdtempSync(join(tmpdir(), 'mnci-vcpkg-root-'))
  write(join(vcpkgRoot, 'scripts/buildsystems/vcpkg.cmake'), '')
  write(join(workspace, 'apps/tool/CMakeLists.txt'), CMAKE)
  location = { name: 'tool', dir: 'apps/tool', ecosystem: 'cmake', manifestPath: join(workspace, 'apps/tool/CMakeLists.txt') }
  savedRoot = process.env.VCPKG_ROOT
  process.env.VCPKG_ROOT = vcpkgRoot
  process.exitCode = undefined
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  mockRunShell.mockReset()
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
  rmSync(vcpkgRoot, { recursive: true, force: true })
  if (savedRoot === undefined) {
    delete process.env.VCPKG_ROOT
  } else {
    process.env.VCPKG_ROOT = savedRoot
  }
  process.exitCode = undefined
  jest.restoreAllMocks()
})

describe('addVcpkgPorts', () => {
  it('writes the manifest, configures with CMake, and links the target the port\'s usage names', () => {
    mockRunShell.mockImplementation(() => {
      write(join(workspace, 'dist/cmake/tool/vcpkg_installed/x64-linux/share/fmt/usage'), USAGE)

      return 0
    })

    addVcpkgPorts(workspace, location, ['fmt'])

    expect(mockRunShell).toHaveBeenCalledWith('cmake', ['-S', join(workspace, 'apps/tool'), '-B', join(workspace, 'dist/cmake/tool'), '-DCMAKE_BUILD_TYPE=Release'], workspace)
    expect(manifestPorts()).toEqual(['fmt'])
    const cmake = readFileSync(location.manifestPath, 'utf8')
    expect(cmake).toContain('VCPKG_ROOT')
    expect(cmake).toContain('# mnci: vcpkg fmt\nfind_package(fmt CONFIG REQUIRED)\ntarget_link_libraries(tool PRIVATE fmt::fmt)\n# mnci: vcpkg fmt end')
    expect(process.exitCode).toBeUndefined()
  })

  it('starts a build tree that was configured before the toolchain was named, which would ignore it', () => {
    write(join(workspace, 'dist/cmake/tool/CMakeCache.txt'), 'CMAKE_BUILD_TYPE:STRING=Release')
    mockRunShell.mockImplementation(() => {
      expect(existsSync(join(workspace, 'dist/cmake/tool/CMakeCache.txt'))).toBe(false)

      return 0
    })

    addVcpkgPorts(workspace, location, ['fmt'])

    expect(mockRunShell).toHaveBeenCalled()
  })

  it('puts the manifest back when CMake cannot configure with the port', () => {
    mockRunShell.mockReturnValue(1)

    addVcpkgPorts(workspace, location, ['not-a-port'])

    expect(existsSync(join(workspace, 'apps/tool/vcpkg.json'))).toBe(false)
    expect(process.exitCode).toBe(1)
  })

  it('changes nothing, and says how to get vcpkg, when VCPKG_ROOT is not set', () => {
    delete process.env.VCPKG_ROOT

    addVcpkgPorts(workspace, location, ['fmt'])

    expect(mockRunShell).not.toHaveBeenCalled()
    expect(existsSync(join(workspace, 'apps/tool/vcpkg.json'))).toBe(false)
    expect(readFileSync(location.manifestPath, 'utf8')).toBe(CMAKE)
    expect(process.exitCode).toBe(1)
  })

  it('refuses a version, a feature or a triplet in the name, without running anything', () => {
    addVcpkgPorts(workspace, location, ['fmt@10', 'fmt[core]'])

    expect(mockRunShell).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('keeps the port and says so when its usage names nothing to link', () => {
    mockRunShell.mockImplementation(() => {
      write(join(workspace, 'dist/cmake/tool/vcpkg_installed/x64-linux/share/zlib/usage'), 'The package zlib is compatible with built-in CMake targets:\n\n    find_package(ZLIB REQUIRED)\n')

      return 0
    })

    addVcpkgPorts(workspace, location, ['zlib'])

    expect(manifestPorts()).toEqual(['zlib'])
    expect(readFileSync(location.manifestPath, 'utf8')).not.toContain('# mnci: vcpkg zlib')
  })
})

describe('removeVcpkgPorts', () => {
  it('removes the manifest entry and exactly the CMake block mnci wrote', () => {
    mockRunShell.mockImplementation(() => {
      write(join(workspace, 'dist/cmake/tool/vcpkg_installed/x64-linux/share/fmt/usage'), USAGE)

      return 0
    })
    addVcpkgPorts(workspace, location, ['fmt'])

    removeVcpkgPorts(workspace, location, ['fmt'])

    expect(manifestPorts()).toEqual([])
    expect(readFileSync(location.manifestPath, 'utf8')).not.toContain('fmt')
    expect(process.exitCode).toBeUndefined()
  })

  it('reports a port the project does not declare', () => {
    removeVcpkgPorts(workspace, location, ['fmt'])

    expect(process.exitCode).toBe(1)
  })
})
