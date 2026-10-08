import { locateStrandedReleaseTags } from '../release-tag-lineage'
import type { Finding } from './finding.contract'

/**
 * Checks that no project's release tags are stranded under a name it no longer has.
 *
 * @remarks
 * See {@link findStrandedReleaseTags}. Skipped when `nx.json` sets a release tag pattern other than mnci's `{projectName}@{version}`, since
 * the lookup name is then not the project name this check assumes. The remedy names each baseline tag.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param nxJson - The parsed `nx.json`.
 * @param nxJson.release - Its release block.
 * @returns A finding when a project would restart from its disk version, otherwise none.
 * @throws Never - a workspace that is not a git repository has no tags to read.
 * @typeParam None - this function has no generic type parameters.
 */
export function checkReleaseTagsResolve (workspaceRoot: string, nxJson: { release?: { releaseTag?: { pattern?: string } } }): Finding | undefined {
  const stranded = locateStrandedReleaseTags(workspaceRoot, nxJson.release?.releaseTag?.pattern)

  return {
    check:  "release tags resolve under each project's current name",
    ok:     stranded.length === 0,
    detail: `${stranded.map(entry => `${entry.project} has only ${entry.oldTag}`).join('; ')} - nx release finds no tag under the new name and would release from the disk version, a downgrade`,
    remedy: `run \`mnci adopt --tags\` to create the baseline tag for each (${stranded.map(entry => entry.newTag).join(', ')}) on the commit of its old tag, then push the tags`,
  }
}
