/** Platform requirements that name the runtime, not a package a registry could be asked about. */
const PLATFORM = /^(?:php(?:-64bit|-ipv6|-zts|-debug)?|hhvm|ext-[\w.-]+|lib-[\w.-]+|composer(?:-plugin-api|-runtime-api)?)$/

/** The `composer.json` blocks that declare packages, with the section label `mnci up` shows for each. */
const BLOCKS: ReadonlyArray<readonly [string, 'dep' | 'devDep']> = [['require', 'dep'], ['require-dev', 'devDep']]

/** A constraint `mnci up` can rewrite: one operator and one version, no `||`, comma, wildcard or stability flag. */
const REWRITABLE = /^(?:[\^~]|>=|<=|[><=])?\d+\.\d+(?:\.\d+)?$/

/**
 * One package requirement read from a `composer.json`.
 *
 * @remarks
 * What `mnci sync` and `mnci up` need of a declaration: the name, the constraint, the block and whether it may be edited.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ComposerRequirement {
  /** The package name, `vendor/package`. */
  name:       string
  /** The constraint, verbatim. */
  spec:       string
  /** Which block declared it. */
  section:    'dep' | 'devDep'
  /** Whether {@link replaceComposerSpec} may edit it: a single operator and version, and not a sibling of this workspace. */
  rewritable: boolean
}

/**
 * Reads the packages a `composer.json` requires.
 *
 * @remarks
 * Platform requirements (`php`, `ext-*`, `lib-*`, `composer-*-api`) are left out: they name the runtime. A package in
 * `siblings` is a project of this workspace, wired by a `path` repository: its version is its own, so it is reported and
 * never rewritten. A compound constraint (`^7.0 || ^8.0`) or a wildcard (`12.*`) is reported and never rewritten either.
 *
 * @param text - The text of a `composer.json`.
 * @param siblings - The names of the other Composer projects in the workspace.
 * @returns One entry per package requirement; empty for invalid JSON.
 * @throws Never - invalid JSON declares nothing.
 * @typeParam None - this function has no generic type parameters.
 */
export function composerRequirements (text: string, siblings: ReadonlySet<string> = new Set()): ComposerRequirement[] {
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(text) as Record<string, unknown>
  } catch {
    return []
  }

  return BLOCKS.flatMap(([block, section]) => {
    const declared = manifest[block]
    if (typeof declared !== 'object' || declared === null) {
      return []
    }

    return Object.entries(declared as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !PLATFORM.test(entry[0]))
      .map(([name, spec]) => ({ name, spec, section, rewritable: REWRITABLE.test(spec.trim()) && !siblings.has(name) }))
  })
}

/**
 * Replaces one package's constraint in a `composer.json`, leaving every other byte as it was.
 *
 * @remarks
 * Edited as text, inside the one block the requirement was read from, so the file's indentation and key order survive and
 * a package listed in both `require` and `require-dev` moves only in its own block.
 *
 * @param text - The text of a `composer.json`.
 * @param name - The package name.
 * @param spec - The new constraint.
 * @param section - The block to edit.
 * @returns The new text, or the text unchanged when the package is not in that block.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function replaceComposerSpec (text: string, name: string, spec: string, section: 'dep' | 'devDep'): string {
  const block = BLOCKS.find(([, label]) => label === section)?.[0]
  const open = block === undefined ? null : new RegExp(String.raw`"${block}"\s*:\s*\{`).exec(text)
  if (open === null) {
    return text
  }
  const start = open.index + open[0].length
  const end = text.indexOf('}', start)
  const inside = text.slice(start, end === -1 ? text.length : end)
  const escaped = name.replaceAll(/[$()*+.?[\\\]^{|}-]/g, String.raw`\$&`)
  const replaced = inside.replace(
    new RegExp(String.raw`("${escaped}"\s*:\s*")[^"]*(")`),
    (_whole, head: string, close: string) => `${head}${spec}${close}`,
  )

  return replaced === inside ? text : text.slice(0, start) + replaced + text.slice(start + inside.length)
}

/**
 * The newest stable release in `composer show --all --format=json <package>`.
 *
 * @remarks
 * The `versions` list comes newest first, with development branches (`dev-main`), pre-releases and a `v` prefix mixed in;
 * the first plain `major.minor[.patch]` is the answer, without its `v`.
 *
 * @param output - The command's standard output.
 * @returns The version, or `undefined` when the output has none.
 * @throws Never - unparseable output is `undefined`.
 * @typeParam None - this function has no generic type parameters.
 */
export function newestStableComposerVersion (output: string): string | undefined {
  try {
    const versions = (JSON.parse(output) as { versions?: unknown }).versions

    return Array.isArray(versions)
      ? versions.map(String).map(each => each.replace(/^v/, '')).find(each => /^\d+\.\d+(?:\.\d+)?$/.test(each))
      : undefined
  } catch {
    return undefined
  }
}
