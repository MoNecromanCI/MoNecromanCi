import type { AdoptionFinding, AdoptionReport, RepositoryFacts } from './adoption-report.contract'

/**
 * Judges what was found in a repository.
 *
 * @remarks
 * A blocker is something adoption cannot start past; a warning is something one of the later
 * steps clears. Both name that step. Pure: the facts are read elsewhere, so each rule has a fixture.
 *
 * @param facts - What the repository holds.
 * @returns The report, blockers before warnings.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function judgeAdoption (facts: RepositoryFacts): AdoptionReport {
  const findings: AdoptionFinding[] = []
  const blocker = (detail: string, step: string): void => { findings.push({ severity: 'blocker', detail, step }) }
  const warning = (detail: string, step: string): void => { findings.push({ severity: 'warning', detail, step }) }

  if (!facts.isGitRepo) {
    blocker('this directory is not a git repository', 'run `git init` (or clone the repository) so every step can be its own commit')
  } else if (facts.dirty) {
    blocker('the working tree has uncommitted changes', 'commit or stash them, so adoption starts from a state you can return to')
  }
  if (facts.packageManager !== undefined && facts.packageManager !== 'npm') {
    blocker(`the repository uses ${facts.packageManager}; mnci workspaces are npm workspaces`, 'convert to npm first (out of scope for adopt for now)')
  }
  if (facts.projects.length === 0) {
    blocker('no project manifest was found under the repository', 'run mnci adopt from the repository root, or `mnci new` for an empty one')
  }

  if (facts.alreadyMnci) {
    warning('nx.json already carries an mnci block, so this is an mnci workspace', 'use `mnci upgrade`; adopt is for repositories mnci has not touched')
  }
  if (facts.nxVersion === undefined) {
    warning('Nx is not installed', 'set Nx up first (`npx nx@latest init`); adopt does not install it yet, and the toolchain and overlay steps need an nx.json')
  }
  if (facts.strandedTags.length > 0) {
    warning(
      `${facts.strandedTags.length} project(s) have release tags only under an old name (${facts.strandedTags.map(entry => entry.project).join(', ')})`,
      'the tags step creates the baseline tags before the first release (#379)',
    )
  }
  if (facts.retiredTooling.length > 0) {
    warning(`retired tooling is present: ${facts.retiredTooling.join(', ')}`, 'the toolchain step removes it (#380)')
  }
  if (facts.ci.length > 0 && !facts.pipelineUsesMnci) {
    warning(`an existing ${facts.ci.join(' and ')} pipeline does not call mnci`, 'the pipeline step moves its custom steps into slots (#381)')
  }
  if (facts.personalFiles.length > 0) {
    warning(`${facts.personalFiles.join(', ')} exist and are yours`, 'adoption leaves them alone; only a block marked by Nx is ever removed')
  }

  const ordered = [...findings.filter(finding => finding.severity === 'blocker'), ...findings.filter(finding => finding.severity === 'warning')]

  return { ready: ordered.every(finding => finding.severity !== 'blocker'), facts, findings: ordered }
}
