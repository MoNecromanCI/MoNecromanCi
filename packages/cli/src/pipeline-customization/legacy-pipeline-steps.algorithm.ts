/**
 * One step of a pipeline's step list, as the lines it occupies in the file.
 *
 * @remarks
 * Steps are read by their layout, not by parsing YAML: a parse would drop the comments a team wrote
 * above its own steps, and those are what it will want back.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface PipelineStep {
  /** Comment and blank lines directly above the step. */
  lead: string[]
  /** The step itself, from its `- ` line to its last line, indentation as in the file. */
  body: string[]
}

/**
 * A step list found in a pipeline file.
 *
 * @remarks
 * Only the first job's list is read: the generated `native` job is mnci's and is regenerated.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface StepList {
  /** The steps, in order. */
  steps:  PipelineStep[]
  /** The number of spaces the list items are indented by. */
  indent: number
}

/** The step names mnci has generated, now and in earlier versions. */
const MNCI_STEP_NAMES = new Set([
  'Add Go tool bin to PATH',
  'Add the Flutter SDK to PATH',
  'Attach HEAD and fetch refs',
  'Attach HEAD to the source branch',
  'Attach the per-platform zips to the GitHub Release (releasable Go apps)',
  "Attach this OS's zip to the GitHub Release (releasable native apps)",
  'Audit dependencies (fails on an actionable npm advisory)',
  'Authenticate npm against the feed (build identity, no PAT)',
  'Authenticate npm registry',
  'Build all deployables',
  'Cache npm packages',
  "Check formatting (run 'npm run format' locally to fix)",
  'Detect .NET projects',
  'Download Go module dependencies',
  'Ensure the function-apps folder exists',
  'Fetch branches and release tags',
  'Install Azure Functions Core Tools',
  'Install dependencies',
  'Install golangci-lint',
  'Install native prerequisites (Linux)',
  'Install Python dependencies (ruff, pytest, build, twine)',
  'Install Python dependencies (ruff, pytest, build, twine, pip-audit)',
  'Install Python project dependencies (editable, workspace-wide)',
  'Lint',
  'Lint, test and build affected projects',
  'Lint, test and build affected projects (PR)',
  'Lint, test and build everything',
  'Lint, test, build and package the native apps',
  'Lint, typecheck, test and build everything',
  'npm audit (fails on an actionable advisory)',
  'npm audit (non-blocking)',
  'Pack all apps (one zip per app -> dist/drop)',
  'Package function apps',
  'Pin npm to the major mnci verifies against',
  'pip-audit (non-blocking)',
  'Preflight — name the PyPI projects this release would create',
  'Preflight — npm must accept the token before anything is tagged',
  'Publish function app packages',
  'Publish packages and tag main',
  'Publish Python packages (uv)',
  'Publish the drop (one zip per app)',
  "Push release tags (nx release's own push never runs without a remote Release configured)",
  'Release (version from commits, tag-only, publish)',
  'Resolve Dart dependencies (one pub get for the whole workspace)',
  'Set the git identity used for release tags',
  'Set up the Go toolchain',
  'Set up the language toolchains (Python, Go, Flutter)',
  'Sign in to Microsoft Entra ID (VS Code Marketplace)',
  'Tag the run per app (type-name)',
  'Test and build everything',
  'Verify the workspace is synced (run \'npx nx sync\' locally and commit if this fails)',
  'Verify this is a full checkout (nx release needs the real tag history)',
])

/** Names that carry a version or a variant, so they are matched by their start. */
const MNCI_STEP_NAME_PATTERNS = [
  /^Install the (\.NET SDK|Flutter SDK)/,
  /^Release — version, tag/,
  /^Verify \(/,
  /^Publish this OS's native zips/,
]

/** Actions and tasks that only a generated pipeline's own steps use. */
const MNCI_USES = ['actions/checkout@', 'actions/setup-node@', 'actions/setup-dotnet@', 'actions/upload-artifact@', 'azure/login@']
const MNCI_TASKS = ['UseNode@', 'Cache@', 'PublishBuildArtifacts@', 'UseDotNet@', 'npmAuthenticate@']

/** Commands a generated pipeline runs as steps of its own. */
const MNCI_COMMANDS = ['npm ci', 'npm install -g npm@', 'git fetch --all', 'git config user.name "github-actions', 'git checkout -B', 'npx mnci ci', 'npx nx sync']

/**
 * Finds the list of steps of the first job of a pipeline file.
 *
 * @remarks
 * The list ends at the first line that is neither a step, nor a comment or blank line, nor part of a
 * step, which is where the next job (the generated `native` job) begins.
 *
 * @param lines - The file's lines.
 * @returns The steps and their indentation, or `undefined` when the file has no step list.
 * @throws Never - pure text reading.
 * @typeParam None - this function has no generic type parameters.
 */
export function findFirstStepList (lines: readonly string[]): StepList | undefined {
  const keyAt = lines.findIndex(line => line.trim() === 'steps:')
  if (keyAt === -1) {
    return undefined
  }
  const firstItem = lines.findIndex((line, index) => index > keyAt && /^\s*- /.test(line))
  if (firstItem === -1) {
    return undefined
  }
  const indent = lines[firstItem].length - lines[firstItem].trimStart().length
  const itemStart = ' '.repeat(indent) + '- '
  const steps: PipelineStep[] = []
  let pending: string[] = []
  let current: PipelineStep | undefined

  for (let index = firstItem; index < lines.length; index++) {
    const line = lines[index]
    const lineIndent = line.length - line.trimStart().length
    const isBlank = line.trim() === ''
    const isComment = line.trimStart().startsWith('#')
    if (line.startsWith(itemStart)) {
      current = { lead: pending, body: [line] }
      steps.push(current)
      pending = []
    } else if (isBlank || (isComment && lineIndent <= indent)) {
      pending.push(line)
    } else if (current && lineIndent > indent) {
      current.body.push(...pending, line)
      pending = []
    } else {
      break
    }
  }

  return { steps, indent }
}

/**
 * The `key: value` pairs at the top level of a step, as written.
 *
 * @param step - The step.
 * @returns A map from key to the text after the colon.
 * @throws Never - pure text reading.
 * @typeParam None - this function has no generic type parameters.
 */
function topLevelFields (step: PipelineStep): Map<string, string> {
  const fields = new Map<string, string>()
  const keyIndent = step.body[0].length - step.body[0].trimStart().length + 2
  for (const [index, line] of step.body.entries()) {
    const text = index === 0 ? line.trimStart().replace(/^- /, '') : line
    const lineIndent = index === 0 ? keyIndent : line.length - line.trimStart().length
    const trimmed = text.trimStart()
    const colon = trimmed.indexOf(':')
    const key = colon === -1 ? '' : trimmed.slice(0, colon)
    if (lineIndent === keyIndent && /^[\w-]+$/.test(key) && !fields.has(key)) {
      fields.set(key, trimmed.slice(colon + 1).trim().replaceAll(/^["']|["']$/g, ''))
    }
  }

  return fields
}

/**
 * Whether a step is one mnci generated, as opposed to one the team added.
 *
 * @remarks
 * Conservative in the direction that matters. A step that is recognised as generated is dropped from
 * the migration, because the new pipeline has its own; one that is not recognised is kept for the
 * team, so an old generated step with a name nobody listed shows up as a duplicate to delete rather
 * than a team step silently lost.
 *
 * @param step - The step.
 * @returns True for a step mnci wrote.
 * @throws Never - pure text reading.
 * @typeParam None - this function has no generic type parameters.
 */
export function isGeneratedStep (step: PipelineStep): boolean {
  const fields = topLevelFields(step)
  const name = fields.get('name') ?? fields.get('displayName')
  if (name !== undefined && (MNCI_STEP_NAMES.has(name) || MNCI_STEP_NAME_PATTERNS.some(pattern => pattern.test(name)))) {
    return true
  }
  const uses = fields.get('uses')
  if (uses !== undefined && MNCI_USES.some(prefix => uses.startsWith(prefix))) {
    return true
  }
  const task = fields.get('task')
  if (task !== undefined && MNCI_TASKS.some(prefix => task.startsWith(prefix))) {
    return true
  }
  if (fields.has('checkout')) {
    return true
  }
  const command = fields.get('run') ?? fields.get('script')

  return command !== undefined && MNCI_COMMANDS.some(prefix => command.startsWith(prefix))
}

/**
 * The step's name, for describing it to the user.
 *
 * @remarks
 * Falls back to the start of the command for a step with no name, which is how a team's quick additions often look.
 *
 * @param step - The step.
 * @returns Its `name` or `displayName`, or the start of its command.
 * @throws Never - pure text reading.
 * @typeParam None - this function has no generic type parameters.
 */
export function describeStep (step: PipelineStep): string {
  const fields = topLevelFields(step)

  return fields.get('name') ?? fields.get('displayName') ?? (fields.get('run') ?? fields.get('script') ?? step.body[0].trim()).slice(0, 60)
}

/**
 * Where a step of the old pipeline sits relative to the phases the new one has.
 *
 * @param step - The step.
 * @returns `verify` for a step that runs the gate, `release` for the release step, `pack` for the pack step, else undefined.
 * @throws Never - pure text reading.
 * @typeParam None - this function has no generic type parameters.
 */
function landmark (step: PipelineStep): 'verify' | 'pack' | 'release' | undefined {
  const name = topLevelFields(step).get('name') ?? topLevelFields(step).get('displayName') ?? ''
  if (/^(?:Verify \(|Lint|Test and build|Typecheck)/.test(name)) {
    return 'verify'
  }
  if (name.startsWith('Pack all apps')) {
    return 'pack'
  }
  if (/^(?:Release|Publish packages and tag)/.test(name)) {
    return 'release'
  }

  return undefined
}

/**
 * What a legacy pipeline's steps say about the team's own work and its choices.
 *
 * @remarks
 * `hasPack` and `hasRelease` tell the migration which choosable phases the team had already removed.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface LegacyReading {
  /** The team's steps for each slot, dedented, comments above them included. */
  slots:      Map<string, string[]>
  /** The names of the team's steps, in order, for telling the user what was kept. */
  kept:       string[]
  /** Whether the old pipeline had a pack step. */
  hasPack:    boolean
  /** Whether the old pipeline had a release step. */
  hasRelease: boolean
}

/**
 * Sorts the steps of a pre-marker pipeline into the team's and mnci's, and the team's into slots.
 *
 * @remarks
 * A team step goes by where it sat: before the gate it is `after-install`, between the gate and the
 * release it is `before-release`, after the release it is `after-release`. A step before the install
 * step cannot keep its place (the new pipeline has no slot there) and is put in `after-install` too.
 *
 * @param lines - The old file's lines.
 * @returns The slots, the kept names and whether the pack and release steps existed.
 * @throws Never - a file with no step list reads as having nothing to keep.
 * @typeParam None - this function has no generic type parameters.
 */
export function readLegacyPipeline (lines: readonly string[]): LegacyReading {
  const reading: LegacyReading = { slots: new Map(), kept: [], hasPack: false, hasRelease: false }
  const list = findFirstStepList(lines)
  if (!list) {
    return reading
  }
  const marks = list.steps.map(step => landmark(step))
  const gate = marks.indexOf('verify')
  const release = marks.indexOf('release')
  reading.hasPack = marks.includes('pack')
  reading.hasRelease = release !== -1

  for (const [index, step] of list.steps.entries()) {
    if (isGeneratedStep(step)) {
      continue
    }
    let slot = 'after-install'
    if (release !== -1 && index > release) {
      slot = 'after-release'
    } else if (gate !== -1 && index > gate) {
      slot = 'before-release'
    }
    const lines_ = [...step.lead, ...step.body].map(line => (line.startsWith(' '.repeat(list.indent)) ? line.slice(list.indent) : line.trimStart()))
    const existing = reading.slots.get(slot) ?? []
    reading.slots.set(slot, [...existing, ...(existing.length > 0 ? [''] : []), ...trimBlank(lines_)])
    reading.kept.push(describeStep(step))
  }

  return reading
}

/**
 * Drops blank lines from the start of a block, so a slot does not gain a gap per step.
 *
 * @param lines - The block.
 * @returns The block without leading blank lines.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function trimBlank (lines: string[]): string[] {
  const first = lines.findIndex(line => line.trim() !== '')

  return first === -1 ? [] : lines.slice(first)
}
