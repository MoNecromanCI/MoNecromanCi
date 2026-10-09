import { locateTagsBehindRegistry } from '../release-tag-lineage'
import type { Finding } from './finding.contract'

/**
 * Checks that no publishable package's registry is ahead of its newest release tag.
 *
 * @remarks
 * `nx release` is tag-only: it reads each package's last version from its tag, so a package published
 * without its tag (a release that failed part way, a tag deleted, a baseline made below the feed)
 * makes the next release propose a version the registry already holds, and a registry refuses a
 * version twice. This is the one doctor check that calls out: it asks the registry through `npm view`.
 * A registry that cannot be reached, and a package it does not know, are not findings.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param lookup - Replaces the registry lookup; only tests pass it.
 * @returns A finding naming each package behind the registry.
 * @throws Never - an unreachable registry yields a passing finding.
 * @typeParam None - this function has no generic type parameters.
 */
export function checkTagsMatchRegistry (workspaceRoot: string, lookup?: Parameters<typeof locateTagsBehindRegistry>[1]): Finding {
  const behind = locateTagsBehindRegistry(workspaceRoot, lookup)

  return {
    check:  'release tags are not behind the registry',
    ok:     behind.length === 0,
    detail: `${behind.map(entry => `${entry.project} is tagged ${entry.tagged} but the registry holds ${entry.published}`).join('; ')} - the next release proposes a version the registry already has and refuses`,
    remedy: `tag the published version on the commit it was built from, then push it: ${behind.map(entry => `git tag ${entry.project}@${entry.published} <commit>`).join('; ')}`,
  }
}
