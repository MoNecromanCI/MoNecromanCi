import { latestVersion, nextTag, type NextTag, type ReleaseCommit } from './next-go-version.algorithm'

/** Separates a commit's subject from its body in the `git log` format below. */
const FIELD = '\u{1F}'
/** Separates one commit from the next. */
const RECORD = '\u{1E}'

/**
 * What {@link releaseGoModule} needs from outside.
 *
 * @remarks
 * `git` runs one git command and returns what it printed, throwing when it fails; it is a parameter so a test can
 * supply a repository without having one.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ReleaseGoModuleOptions {
  /** The module's directory, relative to the repository root, which is also its tag prefix. */
  directory: string
  git:       (arguments_: string[]) => string
  /** Report what would be tagged without creating or pushing anything. */
  dryRun?:   boolean
  log?:      (message: string) => void
}

/**
 * Reads the commits that touched a directory since a tag, newest first.
 *
 * @param git - Runs one git command.
 * @param directory - The directory whose history counts.
 * @param since - The tag to start after, or `undefined` for the whole history.
 * @returns The commits' subjects and bodies.
 * @throws Error when git fails.
 * @typeParam None - this function has no generic type parameters.
 */
function commitsTouching (git: ReleaseGoModuleOptions['git'], directory: string, since: string | undefined): ReleaseCommit[] {
  const range = since === undefined ? [] : [`${since}..HEAD`]

  return git(['log', ...range, `--format=%s${FIELD}%b${RECORD}`, '--', directory])
    .split(RECORD)
    .map(record => record.replace(/^\n/, ''))
    .filter(record => record.trim() !== '')
    .map(record => {
      const [subject, body] = record.split(FIELD)

      return { subject: subject.trim(), body: (body ?? '').trim() }
    })
}

/**
 * Tags a Go module for release when the commits since its last tag call for one.
 *
 * @remarks
 * A Go module in a sub-directory is versioned by tags named `<directory>/vX.Y.Z`, which is also how `go get`
 * finds a version, so the tags are the only state there is. Only commits that touched the module's directory
 * count. The tag is lightweight and is pushed on its own, because `nx release` neither knows nor pushes it.
 *
 * @param options - The directory, git and the flags.
 * @returns What was tagged (or would be, in a dry run), or `undefined` when nothing releases.
 * @throws Error when a git command fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function releaseGoModule (options: ReleaseGoModuleOptions): NextTag | undefined {
  const { directory, git, dryRun = false } = options
  const log = options.log ?? (() => {})
  const prefix = `${directory}/`
  const tags = git(['tag', '--list', `${prefix}v*`]).split('\n').map(tag => tag.trim()).filter(tag => tag !== '')
  const latest = latestVersion(tags, prefix)
  const latestTag = latest === undefined ? undefined : `${prefix}v${latest.join('.')}`
  const commits = commitsTouching(git, directory, latestTag)

  const next = nextTag({ tags, commits, prefix })
  if (next === undefined) {
    log(`${directory}: nothing to release (${commits.length} commit(s) since ${latestTag ?? 'the start'}, none of them a feature, a fix or a breaking change).`)

    return undefined
  }

  log(`${directory}: ${dryRun ? 'would tag' : 'tagging'} ${next.tag} (${next.bump}).`)
  if (!dryRun) {
    git(['tag', next.tag])
    git(['push', 'origin', next.tag])
  }

  return next
}
