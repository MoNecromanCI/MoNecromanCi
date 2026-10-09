import { type Dirent, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isNxAuthoredName, isNxOnlyConfig, NX_CONFIG_FILES } from './recognise-nx-agent-files.algorithm'

/**
 * The directories `create-nx-workspace` writes its AI-agent integration into.
 *
 * @remarks
 * `.github` is not here as a whole, only the three folders under it that Nx writes to, since the rest of it is a
 * workspace's own (workflows, dependabot, issue templates).
 */
const CONTAINERS: readonly string[] = ['.agents', '.codex', '.cursor', '.gemini', '.opencode', '.claude', '.github/agents', '.github/prompts', '.github/skills']

/**
 * The result of {@link removeNxAgentScaffolding}.
 *
 * @remarks
 * `kept` is how a caller can tell the user that a config file was left on purpose.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface AgentScaffoldingRemoval {
  /** Workspace-relative paths that were deleted, with forward slashes. */
  readonly removed: string[]
  /** Config files Nx writes that were left, because they hold more than Nx's entries. */
  readonly kept:    string[]
}

/**
 * Reads a file's text.
 *
 * @remarks
 * A separate function so a file that vanishes between listing and reading is skipped rather than ending the run.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param file - The workspace-relative path.
 * @returns The text, or `undefined` when it cannot be read.
 * @throws Never - an unreadable file is `undefined`.
 * @typeParam None - this function has no generic type parameters.
 */
function readText (workspaceRoot: string, file: string): string | undefined {
  try {
    return readFileSync(join(workspaceRoot, file), 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Every file under a directory, as paths relative to the workspace root.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param directory - The workspace-relative directory to walk.
 * @returns The files, with forward slashes, in directory order.
 * @throws Never - an unreadable directory has no files.
 * @typeParam None - this function has no generic type parameters.
 */
function filesUnder (workspaceRoot: string, directory: string): string[] {
  const files: string[] = []
  let entries: Dirent[]
  try {
    entries = readdirSync(join(workspaceRoot, directory), { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...filesUnder(workspaceRoot, path))
    } else {
      files.push(path)
    }
  }

  return files
}

/**
 * Deletes a directory when nothing is left in it, after doing the same to everything inside it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param directory - The workspace-relative directory.
 * @returns Nothing.
 * @throws Never - a directory that cannot be read or removed is left.
 * @typeParam None - this function has no generic type parameters.
 */
function pruneEmpty (workspaceRoot: string, directory: string): void {
  const absolute = join(workspaceRoot, directory)
  let entries: string[]
  try {
    entries = readdirSync(absolute)
  } catch {
    return
  }
  for (const entry of entries) {
    pruneEmpty(workspaceRoot, `${directory}/${entry}`)
  }
  try {
    if (readdirSync(absolute).length === 0) {
      rmSync(absolute, { recursive: true, force: true })
    }
  } catch {
    // Already gone, or not ours to remove.
  }
}

/**
 * Removes the AI-agent integration `create-nx-workspace` scaffolds, and only that.
 *
 * @remarks
 * It fails `@mnci/eslint-config` (its CI-monitor scripts), so mnci removes it. What it removes is decided per
 * entry, not per directory: a file whose name is Nx's (`ci-monitor-subagent`, `monitor-ci`, `link-workspace-packages`,
 * the `nx-*` skills), and a config file only while it holds nothing but Nx's entries. Anything else in those
 * folders, such as a prompt or an agent the team wrote, stays, and so does a config file the team has added to.
 * Folders that end up empty are removed with the rest. The run is idempotent, and a workspace that never had any of
 * it is untouched. `nx configure-ai-agents` is the supported way to bring it back.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns What was deleted, and the config files that were kept and why they might be wanted.
 * @throws Never - an entry that cannot be read or removed is left.
 * @typeParam None - this function has no generic type parameters.
 */
export function removeNxAgentScaffolding (workspaceRoot: string): AgentScaffoldingRemoval {
  const removed: string[] = []
  const kept: string[] = []

  const judge = (file: string, container: string | undefined): void => {
    const inside = container === undefined ? [file] : file.slice(container.length + 1).split('/')
    if (inside.some(segment => isNxAuthoredName(segment))) {
      rmSync(join(workspaceRoot, file), { force: true })
      removed.push(file)

      return
    }
    if (NX_CONFIG_FILES.includes(file)) {
      const text = readText(workspaceRoot, file)
      if (text === undefined) {
        return
      }
      if (isNxOnlyConfig(file, text)) {
        rmSync(join(workspaceRoot, file), { force: true })
        removed.push(file)
      } else {
        kept.push(file)
      }
    }
  }

  for (const container of CONTAINERS) {
    if (!existsSync(join(workspaceRoot, container))) {
      continue
    }
    for (const file of filesUnder(workspaceRoot, container)) {
      judge(file, container)
    }
    pruneEmpty(workspaceRoot, container)
  }
  if (existsSync(join(workspaceRoot, 'opencode.json'))) {
    judge('opencode.json', undefined)
  }

  return { removed, kept }
}
