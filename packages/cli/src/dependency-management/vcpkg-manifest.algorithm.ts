/**
 * The CMake lines that let a project use vcpkg when `VCPKG_ROOT` is set.
 *
 * @remarks
 * Before `project()`, as vcpkg's toolchain file must be, and conditional: a machine with no vcpkg configures the project
 * exactly as before. `CMAKE_TOOLCHAIN_FILE` set by the caller wins. vcpkg's own `VCPKG_DEFAULT_TRIPLET` and
 * `VCPKG_DEFAULT_HOST_TRIPLET` are passed on as the CMake variables the toolchain reads, which is how a MinGW machine names
 * `x64-mingw-static` once instead of on every configure. vcpkg then installs the project's `vcpkg.json` into the
 * build directory (`vcpkg_installed` beside the build tree), which each project already keeps under `dist/`.
 */
export const VCPKG_TOOLCHAIN_HOOK: readonly string[] = [
  'if(DEFINED ENV{VCPKG_ROOT} AND NOT DEFINED CMAKE_TOOLCHAIN_FILE)',
  '  set(CMAKE_TOOLCHAIN_FILE "$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake" CACHE STRING "")',
  '  # The toolchain reads the CMake variables, not the environment ones of vcpkg, and cannot tell MinGW from MSVC before project().',
  '  if(DEFINED ENV{VCPKG_DEFAULT_TRIPLET} AND NOT DEFINED VCPKG_TARGET_TRIPLET)',
  '    set(VCPKG_TARGET_TRIPLET "$ENV{VCPKG_DEFAULT_TRIPLET}" CACHE STRING "")',
  '  endif()',
  '  if(DEFINED ENV{VCPKG_DEFAULT_HOST_TRIPLET} AND NOT DEFINED VCPKG_HOST_TRIPLET)',
  '    set(VCPKG_HOST_TRIPLET "$ENV{VCPKG_DEFAULT_HOST_TRIPLET}" CACHE STRING "")',
  '  endif()',
  'endif()',
]

/**
 * Whether a name is one vcpkg accepts for a port.
 *
 * @remarks
 * vcpkg port names are lowercase letters, digits and hyphens. A name with `@`, `:` or `[` (a version, a triplet, a feature)
 * is refused rather than guessed at.
 *
 * @param name - What the user typed after `mnci install`.
 * @returns `true` for a plain port name.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function isVcpkgPortName (name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}

/**
 * Makes a vcpkg manifest name from a project name.
 *
 * @param project - The project name, such as `my_tool`.
 * @returns Lowercase letters, digits and hyphens, which is what the manifest's `name` allows.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function manifestName (project: string): string {
  return project.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'project'
}

/**
 * Reads the ports a `vcpkg.json` depends on.
 *
 * @remarks
 * A dependency is a plain name or an object with a `name`; both are read, so a manifest with features still lists its ports.
 *
 * @param text - The text of `vcpkg.json`.
 * @returns The port names, in order; empty when the text is not a manifest.
 * @throws Never - unreadable text names nothing.
 * @typeParam None - this function has no generic type parameters.
 */
export function vcpkgPorts (text: string): string[] {
  try {
    const parsed = JSON.parse(text) as { dependencies?: unknown }
    const dependencies = Array.isArray(parsed.dependencies) ? parsed.dependencies as unknown[] : []

    return dependencies
      .map(entry => (typeof entry === 'string' ? entry : (entry as { name?: unknown } | null)?.name))
      .filter((name): name is string => typeof name === 'string')
  } catch {
    return []
  }
}

/**
 * Adds a port to a project's `vcpkg.json`, creating the manifest when there is none.
 *
 * @remarks
 * Idempotent. Everything else in an existing manifest (overrides, features, the baseline) is kept as it was.
 *
 * @param existing - The current text, or `undefined` when the project has no manifest.
 * @param project - The project name, for a new manifest.
 * @param port - The port to add.
 * @returns The new text, or `undefined` when the existing text is not a JSON object (it must be left alone).
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function addVcpkgPort (existing: string | undefined, project: string, port: string): string | undefined {
  let manifest: Record<string, unknown>
  if (existing === undefined) {
    manifest = { name: manifestName(project), version: '0.1.0', dependencies: [] }
  } else {
    try {
      const parsed: unknown = JSON.parse(existing)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return undefined
      }
      manifest = parsed as Record<string, unknown>
    } catch {
      return undefined
    }
  }
  const dependencies = Array.isArray(manifest['dependencies']) ? manifest['dependencies'] as unknown[] : []
  if (vcpkgPorts(JSON.stringify({ dependencies })).includes(port)) {
    return existing
  }

  return `${JSON.stringify({ ...manifest, dependencies: [...dependencies, port] }, null, 2)}\n`
}

/**
 * Removes a port from a project's `vcpkg.json`.
 *
 * @remarks
 * Both dependency shapes match by name. Everything else in the manifest is kept, and a manifest that does not hold the port
 * comes back unchanged.
 *
 * @param text - The text of `vcpkg.json`.
 * @param port - The port to remove.
 * @returns The new text and whether the port was there; the text unchanged when it was not or is not a manifest.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeVcpkgPort (text: string, port: string): { text: string, removed: boolean } {
  try {
    const parsed = JSON.parse(text) as { dependencies?: unknown }
    if (!Array.isArray(parsed.dependencies)) {
      return { text, removed: false }
    }
    const kept = (parsed.dependencies as unknown[]).filter(entry => (typeof entry === 'string' ? entry : (entry as { name?: unknown } | null)?.name) !== port)
    if (kept.length === parsed.dependencies.length) {
      return { text, removed: false }
    }

    return { text: `${JSON.stringify({ ...parsed, dependencies: kept }, null, 2)}\n`, removed: true }
  } catch {
    return { text, removed: false }
  }
}

/**
 * Puts the vcpkg toolchain hook into a project's `CMakeLists.txt`, once.
 *
 * @remarks
 * After `cmake_minimum_required` and before `project()`. A file that already names `VCPKG_ROOT` is left as it is.
 *
 * @param text - The text of `CMakeLists.txt`.
 * @returns The text with the hook; unchanged when it is there or there is no `cmake_minimum_required` to follow.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function withVcpkgToolchainHook (text: string): string {
  if (text.includes('VCPKG_ROOT')) {
    return text
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const minimum = /^cmake_minimum_required\([^)]*\)[ \t]*\r?\n/m.exec(text)
  if (minimum === null) {
    return text
  }
  const end = minimum.index + minimum[0].length

  return text.slice(0, end) + VCPKG_TOOLCHAIN_HOOK.join(newline) + newline + text.slice(end)
}

/**
 * Reads the lines a port's `usage` file says to put in `CMakeLists.txt`.
 *
 * @remarks
 * vcpkg writes `share/<port>/usage` with the exact `find_package` and `target_link_libraries(main PRIVATE ...)` lines.
 * The first block that links something is taken, with `main` standing for the project's own target. A port that is
 * header-only with no CMake target (it says `find_path`) has such a block too, so it comes out the same way.
 *
 * @param usage - The text of the port's `usage` file.
 * @param target - The project's CMake target.
 * @returns The lines to add, or `undefined` when the file names no `target_link_libraries`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function parseVcpkgUsage (usage: string, target: string): string[] | undefined {
  const blocks: string[][] = [[]]
  for (const raw of usage.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') {
      blocks.push([])
    } else if (/^(?:find_package|find_path|find_library|find_program|target_link_libraries|target_include_directories|include|add_)/.test(line)) {
      blocks.at(-1)?.push(line)
    }
  }
  const block = blocks.find(candidate => candidate.some(line => line.startsWith('target_link_libraries(')))
  if (block === undefined) {
    return undefined
  }

  return block.map(line => (/^target_\w+\(main\b/.test(line) ? line.replace('(main', () => `(${target}`) : line))
}

/**
 * Adds a port's CMake lines to a project's `CMakeLists.txt` between two marker comments.
 *
 * @remarks
 * The markers are how `mnci uninstall` finds exactly what was added. Idempotent per port. The lines go at the end of the
 * file, after the project's target is defined, as a sibling link does.
 *
 * @param text - The text of `CMakeLists.txt`.
 * @param port - The port the lines are for.
 * @param lines - The lines from {@link parseVcpkgUsage}.
 * @returns The new text; the same text when the port already has its block.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function addVcpkgLink (text: string, port: string, lines: readonly string[]): string {
  const begin = `# mnci: vcpkg ${port}`
  if (text.includes(`${begin}\n`) || text.includes(`${begin}\r\n`)) {
    return text
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const block = ['', begin, ...lines, `${begin} end`, ''].join(newline)

  return `${text.endsWith('\n') ? text : text + newline}${block}`
}

/**
 * Removes the CMake lines {@link addVcpkgLink} added for a port.
 *
 * @remarks
 * Only what is between the port's two marker comments goes, with the blank line before it, so hand-written lines survive.
 *
 * @param text - The text of `CMakeLists.txt`.
 * @param port - The port.
 * @returns The new text; the same text when the port has no block.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeVcpkgLink (text: string, port: string): string {
  const escaped = port.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

  return text.replace(new RegExp(String.raw`(?:\r?\n)?# mnci: vcpkg ${escaped}\r?\n[\s\S]*?# mnci: vcpkg ${escaped} end(?:\r?\n)?`), '')
}
