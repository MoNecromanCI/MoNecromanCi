import { runCapture } from '../nx-workspace'

/** The one-line program a child Node process runs: print the newest release the repository's metadata names. */
const LOOKUP_SCRIPT = [
  'const url = process.argv[1]',
  'fetch(url, { signal: AbortSignal.timeout(15000) })',
  '  .then(response => (response.ok ? response.text() : ""))',
  '  .then(text => {',
  String.raw`    const release = /<release>([^<]+)<\/release>/.exec(text)`,
  String.raw`    const all = [...text.matchAll(/<version>([^<]+)<\/version>/g)]`,
  '    const version = release ? release[1] : all.length > 0 ? all[all.length - 1][1] : ""',
  '    if (version) console.log(version.trim())',
  '  })',
  '  .catch(() => {})',
].join('\n')

/** Where the Maven Central metadata of an artifact lives. */
const CENTRAL = 'https://repo.maven.apache.org/maven2'

/**
 * The newest release of a Maven artifact on Maven Central.
 *
 * @remarks
 * Read from the artifact's `maven-metadata.xml`, which is what `mvn` itself consults for `RELEASE`. It is a child Node
 * process because `mnci install` is synchronous and a fetch is not. Only Maven Central is asked: a private feed named in
 * `settings.xml` is not read yet, so a package that lives only there needs its version written (`group:artifact@1.2.3`).
 *
 * @param groupId - The artifact's group.
 * @param artifactId - The artifact's id.
 * @param cwd - Where the child process runs.
 * @returns The version, or `undefined` when the artifact is unknown to Maven Central or it is unreachable.
 * @throws Never - a failed lookup is `undefined`.
 * @typeParam None - this function has no generic type parameters.
 */
export function latestMavenRelease (groupId: string, artifactId: string, cwd: string): string | undefined {
  const url = `${CENTRAL}/${groupId.replaceAll('.', '/')}/${artifactId}/maven-metadata.xml`
  const result = runCapture(process.execPath, ['-e', LOOKUP_SCRIPT, url], cwd)
  const version = result.stdout.trim()

  return result.status === 0 && version.length > 0 ? version : undefined
}
