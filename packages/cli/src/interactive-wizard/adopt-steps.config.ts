/**
 * One step of `mnci adopt`, as the wizard offers it.
 *
 * @remarks
 * `switch` is the flag that selects the step (none for the read-only report); `options` are the other flags
 * that step takes. Every flag of `mnci adopt` must appear in exactly one step, or be named in
 * {@link ADOPT_GLOBAL_OPTIONS}: a spec fails when a new flag is in neither, so a step cannot be added to the
 * command and be unreachable from the wizard.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface AdoptStep {
  /** A short id. */
  id:      string
  /** What the person reads. */
  label:   string
  /** What the step does, one line. */
  summary: string
  /** The flag that selects it, without dashes; absent for the report. */
  switch?: string
  /** The other flags the step takes, without dashes. */
  options: readonly string[]
}

/**
 * Flags that work with every step, offered after the step is chosen.
 *
 * @remarks
 * Only `--json` today: it changes how a step reports, not what it does.
 */
export const ADOPT_GLOBAL_OPTIONS: readonly string[] = ['json']

/**
 * The steps of `mnci adopt`, in the order they are meant to run.
 *
 * @remarks
 * A spec compares this with the flags `mnci adopt` declares, in both directions.
 */
export const ADOPT_STEPS: readonly AdoptStep[] = [
  { id: 'report', label: 'Report', summary: 'read the repository and say what adopting it involves (changes nothing)', options: [] },
  { id: 'tags', label: 'Baseline release tags', summary: 'create the tag each renamed project needs so a release continues from its last version', switch: 'tags', options: [] },
  { id: 'toolchain', label: 'Toolchain', summary: 'retire old tooling, align Nx to one version, make the audit pass', switch: 'toolchain', options: ['nx'] },
  { id: 'kinds', label: 'Project kinds', summary: 'record each project\'s kind as a type tag', switch: 'kinds', options: ['kind'] },
  { id: 'dependencies', label: 'Dependencies', summary: 'move root runtime dependencies into the projects that import them', switch: 'dependencies', options: [] },
  {
    id:      'overlay',
    label:   'Overlay and pipeline',
    summary: 'apply the release config, .npmrc, commitlint and the CI pipeline',
    switch:  'overlay',
    options: ['scope', 'registry', 'organization', 'project', 'artifacts-feed', 'agent', 'variable-group', 'npm-auth', 'ci', 'test-runner'],
  },
]
