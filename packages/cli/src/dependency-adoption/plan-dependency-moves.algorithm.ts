/**
 * Where one root dependency is imported.
 *
 * @remarks
 * `runtime` are the projects with a non-test source file that imports it; `testsOnly` are the projects that
 * import it only from test files, where it is a development need.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface DependencyUsage {
  /** Project directories importing it from source that ships. */
  runtime:   string[]
  /** Project directories importing it only from tests. */
  testsOnly: string[]
}

/**
 * One dependency to add to one project.
 *
 * @remarks
 * The range is the one the root declared, so the resolved version does not change.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface DependencyMove {
  /** The package. */
  name:  string
  /** The range the root declared. */
  range: string
  /** The project that receives it. */
  dir:   string
  /** Where in that project's manifest it goes. */
  field: 'dependencies' | 'devDependencies'
}

/**
 * What the plan decided.
 *
 * @remarks
 * `keptAtRoot` and `conflicts` are for the person: the first names what no project imports (so it may be
 * root tooling, or unused), the second names a project that already declared the package at a different range.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface DependencyPlan {
  /** Entries to add to project manifests. */
  moves:      DependencyMove[]
  /** Packages removed from the root, because every project that imports them now declares them. */
  removed:    string[]
  /** Root packages no project imports, left where they are, with why. */
  keptAtRoot: { name: string, reason: string }[]
  /** Projects that declared a moved package already, at another range; their own range is kept. */
  conflicts:  { name: string, dir: string, projectRange: string, rootRange: string }[]
}

/**
 * Plans which root dependencies move into which projects.
 *
 * @remarks
 * A package goes into the `dependencies` of each project that imports it from shipped source, and into the
 * `devDependencies` of a project that imports it only from tests. A project that already declares it keeps its
 * own declaration (a different range is reported, never overwritten). A package no project imports stays at
 * the root and is listed: it may be tooling the root scripts use, or it may be unused, and only a person knows.
 * The root entry is removed only for packages that were moved.
 *
 * @param rootDependencies - The root manifest's `dependencies`.
 * @param usage - Where each is imported, by package name.
 * @param declared - What each project's manifest already declares, by directory.
 * @returns The plan.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function planDependencyMoves (
  rootDependencies: Readonly<Record<string, string>>,
  usage: Readonly<Record<string, DependencyUsage>>,
  declared: Readonly<Record<string, Readonly<Record<string, string>>>>,
): DependencyPlan {
  const plan: DependencyPlan = { moves: [], removed: [], keptAtRoot: [], conflicts: [] }
  for (const [name, range] of Object.entries(rootDependencies)) {
    const where = usage[name]
    const runtime = where?.runtime ?? []
    const testsOnly = where?.testsOnly ?? []
    if (runtime.length === 0 && testsOnly.length === 0) {
      plan.keptAtRoot.push({ name, reason: 'no project imports it: it may be tooling the root uses, or unused' })
      continue
    }
    const targets: [string, DependencyMove['field']][] = [
      ...runtime.map((dir): [string, DependencyMove['field']] => [dir, 'dependencies']),
      ...testsOnly.map((dir): [string, DependencyMove['field']] => [dir, 'devDependencies']),
    ]
    for (const [dir, field] of targets) {
      const existing = declared[dir]?.[name]
      if (existing === undefined) {
        plan.moves.push({ name, range, dir, field })
      } else if (existing !== range) {
        plan.conflicts.push({ name, dir, projectRange: existing, rootRange: range })
      }
    }
    plan.removed.push(name)
  }

  return plan
}
