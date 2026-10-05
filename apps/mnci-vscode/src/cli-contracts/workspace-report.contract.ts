/**
 * The language family of a project kind.
 *
 * @remarks
 * Mirrors `ProjectLanguage` in the CLI's `project-scaffolding` slice.
 * @typeParam None - this type has no generic type parameters.
 */
export type ProjectLanguage = 'typescript' | 'python' | 'go' | 'flutter' | 'csharp'

/**
 * One project kind `mnci add` accepts.
 *
 * @remarks
 * Mirrors the CLI's `mnci kinds --json`.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ProjectKindDescription {
  readonly kind:           string
  readonly language:       ProjectLanguage
  readonly label:          string
  readonly description:    string
  /** Names of the `add` options that apply to this kind. */
  readonly flags:          readonly string[]
  /** Flags the kind cannot be added without (older CLIs omit this). */
  readonly requiredFlags?: readonly string[]
}

/**
 * One project of the workspace.
 *
 * @remarks
 * Mirrors the CLI's `mnci projects --json`.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ProjectSummary {
  /** The name to pass to `nx run <name>:<target>`. */
  readonly name:      string
  /** Workspace-relative directory, forward-slashed. */
  readonly dir:       string
  readonly ecosystem: string
  /** The `type:*` tag mnci put on the project, when it has one. */
  readonly kind?:     string
  readonly targets:   readonly string[]
}

/**
 * The installed CLI, the newest published one, and the workspace's recorded settings.
 *
 * @remarks
 * Mirrors the CLI's `mnci info --json`. `workspace` is `null` outside a workspace.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface WorkspaceInfo {
  readonly cli:       {
    readonly version:         string
    readonly latest:          string | null
    readonly updateAvailable: boolean
  }
  readonly workspace: {
    readonly root:   string
    readonly config: Readonly<Record<string, unknown>>
  } | null
}

/**
 * One invariant `mnci doctor` checked.
 *
 * @remarks
 * Mirrors a finding of the CLI's `mnci doctor --json`.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface DoctorFinding {
  readonly check:   string
  readonly ok:      boolean
  readonly detail?: string
  /** The command or edit that fixes it. */
  readonly remedy?: string
}

/**
 * What `mnci doctor --json` prints.
 *
 * @remarks
 * Mirrors the CLI's `mnci doctor --json`.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface DoctorReport {
  readonly findings: readonly DoctorFinding[]
  readonly passed:   number
  readonly failed:   number
}
