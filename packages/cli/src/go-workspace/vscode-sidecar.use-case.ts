import { globSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, toJson, writeFileEnsured } from '../file-system'
import { VSCODE_EXTENSION_TAG } from '../workspace-overlay'

/** A VS Code extension that ships a Go app, and whether its `nx` block depends on it. */
export interface VscodeSidecar {
  /** Workspace-relative path of the extension's `package.json`. */
  manifestPath: string
  /** The extension's name. */
  extension:    string
  /** The Go app whose binaries it ships. */
  sidecar:      string
  /** Whether the extension already depends on the sidecar. */
  declared:     boolean
}

/** The slice of an extension's `package.json` this module reads and writes. */
interface ExtensionManifest {
  name?: string
  nx?: {
    name?:                 string
    tags?:                 string[]
    implicitDependencies?: string[]
    targets?:              { package?: { options?: { command?: string } } }
  }
}

/**
 * The Go app an extension ships, read from where `mnci add vscode-extension --sidecar` records it.
 *
 * @remarks
 * Only the `package` target's command names it (`node tools/vscode-extension.cjs package
 * apps/<name> --sidecar <go-app>`), so that is what is read back: it lets an extension
 * generated before the dependency was declared be repaired, with no second source of truth.
 *
 * @param manifest - The extension's parsed `package.json`.
 * @returns The sidecar's name, or `undefined` for an extension that ships none.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function sidecarOf (manifest: ExtensionManifest): string | undefined {
  return /--sidecar\s+(?<sidecar>\S+)/.exec(manifest.nx?.targets?.package?.options?.command ?? '')?.groups?.sidecar
}

/**
 * Every extension in the workspace that ships a Go app, and whether it depends on it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns One entry per extension with a sidecar, declared or not.
 * @throws Error when an extension's `package.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function findVscodeSidecars (workspaceRoot: string): VscodeSidecar[] {
  // Sorted: `globSync` returns what the filesystem lists, in no promised order, and doctor
  // prints one line per extension.
  const manifests = globSync('apps/*/package.json', { cwd: workspaceRoot }).toSorted((a, b) => a.localeCompare(b))

  return manifests.flatMap((relativePath) => {
    const manifest = readJson<ExtensionManifest>(join(workspaceRoot, relativePath))
    const sidecar = sidecarOf(manifest)
    if (sidecar === undefined || !manifest.nx?.tags?.includes(VSCODE_EXTENSION_TAG)) {
      return []
    }

    return [{
      manifestPath: relativePath.replaceAll('\\', '/'),
      extension:    manifest.nx.name ?? manifest.name ?? relativePath,
      sidecar,
      declared:     (manifest.nx.implicitDependencies ?? []).includes(sidecar),
    }]
  })
}

/**
 * Makes each extension depend on the Go app it ships, where it does not already.
 *
 * @remarks
 * Without the edge, `nx release` sees no change to the extension when only a Go library
 * its sidecar imports changed: it counts the commits that touch a project and its graph
 * dependencies, and `--sidecar` was only ever a string in a command. The extension was then
 * never versioned, tagged or published, whatever happened to the engine inside it.
 * Keeps any other implicit dependency, and is idempotent.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns The workspace-relative `package.json` files it changed.
 * @throws Error when an extension's `package.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function declareSidecarDependencies (workspaceRoot: string): string[] {
  const changed: string[] = []
  const undeclared = findVscodeSidecars(workspaceRoot).filter(each => !each.declared)
  for (const extension of undeclared) {
    const manifestPath = join(workspaceRoot, extension.manifestPath)
    const manifest = readJson<ExtensionManifest>(manifestPath)
    writeFileEnsured(
      manifestPath,
      toJson({ ...manifest, nx: { ...manifest.nx, implicitDependencies: [...(manifest.nx?.implicitDependencies ?? []), extension.sidecar] } }),
    )
    changed.push(extension.manifestPath)
  }

  return changed
}
