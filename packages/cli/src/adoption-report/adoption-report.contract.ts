import type { StrandedReleaseTag } from '../release-tag-lineage'

/**
 * One project the repository already holds.
 *
 * @remarks
 * Only what the report needs: where it is and which toolchain owns its manifest.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface FoundProject {
  /** The directory's basename. */
  name:      string
  /** The directory, relative to the repository root, with forward slashes. */
  dir:       string
  /** The ecosystem whose manifest was found. */
  ecosystem: string
}

/**
 * What `mnci adopt` read from a repository, before any judgement.
 *
 * @remarks
 * Plain facts, so the policy that judges them is a pure function with a fixture per case.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface RepositoryFacts {
  /** Whether the directory is inside a git work tree. */
  isGitRepo:        boolean
  /** Whether the work tree has uncommitted changes. */
  dirty:            boolean
  /** The package manager its lockfile names, when there is one. */
  packageManager?:  'npm' | 'pnpm' | 'yarn' | 'bun'
  /** The `nx` version the root manifest asks for, when it does. */
  nxVersion?:       string
  /** Whether `nx.json` already carries an `mnci` block. */
  alreadyMnci:      boolean
  /** Every project manifest found. */
  projects:         FoundProject[]
  /** How many tags the repository has. */
  tagCount:         number
  /** Projects whose release tags sit under a name they no longer have. */
  strandedTags:     StrandedReleaseTag[]
  /** The CI providers whose pipeline file exists. */
  ci:               ('azure' | 'github')[]
  /** Whether a pipeline already calls `mnci ci`. */
  pipelineUsesMnci: boolean
  /** Tooling mnci retired, by file, script or dependency name. */
  retiredTooling:   string[]
  /** Root files a person writes instructions in, which adoption must leave alone. */
  personalFiles:    string[]
}

/**
 * How much a finding matters.
 *
 * @remarks
 * A blocker stops adoption; a warning is something a later step clears.
 * @typeParam None - this type has no generic type parameters.
 */
export type FindingSeverity = 'blocker' | 'warning'

/**
 * One thing the report says about the repository.
 *
 * @remarks
 * Every blocker names the step that clears it, the same rule `mnci doctor` follows.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface AdoptionFinding {
  /** A blocker stops adoption; a warning is something a later step deals with. */
  severity: FindingSeverity
  /** What was found. */
  detail:   string
  /** What clears it. */
  step:     string
}

/**
 * The whole report.
 *
 * @remarks
 * `ready` is true when nothing blocks. It is what the exit code and an editor read.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface AdoptionReport {
  /** Whether adoption could start now. */
  ready:    boolean
  /** The facts the findings were drawn from. */
  facts:    RepositoryFacts
  /** Blockers first, then warnings. */
  findings: AdoptionFinding[]
}
