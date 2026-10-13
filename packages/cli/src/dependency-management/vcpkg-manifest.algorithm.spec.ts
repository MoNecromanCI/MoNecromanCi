import {
  addVcpkgLink,
  addVcpkgPort,
  isVcpkgPortName,
  parseVcpkgUsage,
  removeVcpkgLink,
  removeVcpkgPort,
  vcpkgPorts,
  VCPKG_TOOLCHAIN_HOOK,
  withVcpkgToolchainHook,
} from './vcpkg-manifest.algorithm'

const USAGE = [
  'The package fmt provides CMake targets:',
  '',
  '    find_package(fmt CONFIG REQUIRED)',
  '    target_link_libraries(main PRIVATE fmt::fmt)',
  '',
  '    # Or use the header-only version',
  '    find_package(fmt CONFIG REQUIRED)',
  '    target_link_libraries(main PRIVATE fmt::fmt-header-only)',
  '',
].join('\n')

describe('isVcpkgPortName', () => {
  it('accepts lowercase words and refuses a version, a feature, a triplet or a scope', () => {
    expect(isVcpkgPortName('fmt')).toBe(true)
    expect(isVcpkgPortName('boost-asio')).toBe(true)
    for (const name of ['fmt@10', 'fmt:x64-linux', 'fmt[core]', 'Fmt', '-fmt', '@scope/pkg']) {
      expect(isVcpkgPortName(name)).toBe(false)
    }
  })
})

describe('addVcpkgPort and vcpkgPorts', () => {
  it('creates a manifest named after the project when there is none', () => {
    const text = addVcpkgPort(undefined, 'My_Tool', 'fmt') as string

    expect(JSON.parse(text)).toEqual({ name: 'my-tool', version: '0.1.0', dependencies: ['fmt'] })
  })

  it('adds beside existing ports and keeps every other key', () => {
    const existing = JSON.stringify({ 'name': 'x', 'version': '1.0.0', 'builtin-baseline': 'abc', 'dependencies': ['zlib', { name: 'curl', features: ['ssl'] }] })
    const text = addVcpkgPort(existing, 'x', 'fmt') as string

    expect(vcpkgPorts(text)).toEqual(['zlib', 'curl', 'fmt'])
    expect(JSON.parse(text)['builtin-baseline']).toBe('abc')
  })

  it('is idempotent, and never overwrites a manifest that is not a JSON object', () => {
    const once = addVcpkgPort(undefined, 'x', 'fmt') as string

    expect(addVcpkgPort(once, 'x', 'fmt')).toBe(once)
    expect(addVcpkgPort('{ nope', 'x', 'fmt')).toBeUndefined()
    expect(addVcpkgPort('[1]', 'x', 'fmt')).toBeUndefined()
  })
})

describe('removeVcpkgPort', () => {
  it('removes a plain or object dependency by name', () => {
    const text = JSON.stringify({ name: 'x', dependencies: ['fmt', { name: 'curl', features: ['ssl'] }] })

    expect(vcpkgPorts(removeVcpkgPort(text, 'fmt').text)).toEqual(['curl'])
    expect(vcpkgPorts(removeVcpkgPort(text, 'curl').text)).toEqual(['fmt'])
  })

  it('reports a port that is not there, leaving the text', () => {
    const text = JSON.stringify({ name: 'x', dependencies: ['fmt'] })

    expect(removeVcpkgPort(text, 'zlib')).toEqual({ text, removed: false })
    expect(removeVcpkgPort('{ nope', 'fmt')).toEqual({ text: '{ nope', removed: false })
  })
})

describe('withVcpkgToolchainHook', () => {
  const cmake = 'cmake_minimum_required(VERSION 3.20)\nproject(x VERSION 0.1.0 LANGUAGES CXX)\n'

  it('puts the hook between cmake_minimum_required and project()', () => {
    const next = withVcpkgToolchainHook(cmake)

    expect(next).toBe(`cmake_minimum_required(VERSION 3.20)\n${VCPKG_TOOLCHAIN_HOOK.join('\n')}\nproject(x VERSION 0.1.0 LANGUAGES CXX)\n`)
  })

  it('names the triplets the toolchain reads, taken from vcpkg\'s own environment variables', () => {
    const hook = VCPKG_TOOLCHAIN_HOOK.join('\n')

    expect(hook).toContain('VCPKG_TARGET_TRIPLET')
    expect(hook).toContain('ENV{VCPKG_DEFAULT_TRIPLET}')
    expect(hook).toContain('VCPKG_HOST_TRIPLET')
  })

  it('is idempotent, keeps CRLF, and leaves a file with no cmake_minimum_required alone', () => {
    const once = withVcpkgToolchainHook(cmake)

    expect(withVcpkgToolchainHook(once)).toBe(once)
    expect(withVcpkgToolchainHook(cmake.replaceAll('\n', '\r\n'))).not.toMatch(/[^\r]\n/)
    expect(withVcpkgToolchainHook('project(x)\n')).toBe('project(x)\n')
  })
})

describe('parseVcpkgUsage', () => {
  it('takes the first block that links, with main standing for the project target', () => {
    expect(parseVcpkgUsage(USAGE, 'my_tool')).toEqual(['find_package(fmt CONFIG REQUIRED)', 'target_link_libraries(my_tool PRIVATE fmt::fmt)'])
  })

  it('answers nothing for a usage text that links nothing', () => {
    expect(parseVcpkgUsage('The package zlib is compatible with built-in CMake targets:\n\n    find_package(ZLIB REQUIRED)\n', 'x')).toBeUndefined()
  })
})

describe('addVcpkgLink and removeVcpkgLink', () => {
  const cmake = 'project(x)\nadd_executable(x main.cpp)\n'
  const lines = ['find_package(fmt CONFIG REQUIRED)', 'target_link_libraries(x PRIVATE fmt::fmt)']

  it('appends a marked block once, and removes exactly it', () => {
    const added = addVcpkgLink(cmake, 'fmt', lines)

    expect(added).toContain('# mnci: vcpkg fmt\nfind_package(fmt CONFIG REQUIRED)\ntarget_link_libraries(x PRIVATE fmt::fmt)\n# mnci: vcpkg fmt end')
    expect(addVcpkgLink(added, 'fmt', lines)).toBe(added)
    expect(removeVcpkgLink(added, 'fmt')).toBe(cmake)
  })

  it('leaves hand-written lines and another port\'s block alone', () => {
    const both = addVcpkgLink(addVcpkgLink(cmake, 'fmt', lines), 'zlib', ['find_package(ZLIB REQUIRED)'])

    expect(removeVcpkgLink(both, 'fmt')).toContain('# mnci: vcpkg zlib')
    expect(removeVcpkgLink(cmake, 'fmt')).toBe(cmake)
  })
})
