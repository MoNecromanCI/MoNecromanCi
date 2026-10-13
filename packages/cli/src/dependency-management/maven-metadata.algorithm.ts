/** A version qualifier that marks a pre-release: `1.0-alpha1`, `2.0.0-RC2`, `3.0-M1`, `1.0-SNAPSHOT`. */
const PRE_RELEASE = /[-.](?:alpha|beta|rc|cr|m\d|milestone|preview|dev|snapshot|ea)/i

/**
 * Where an artifact's `maven-metadata.xml` lives in a repository.
 *
 * @remarks
 * The group's dots become folders, as every Maven repository lays it out, so the URL needs no search.
 *
 * @param base - The repository root, without a trailing slash.
 * @param name - The artifact as `group:artifact`.
 * @returns The metadata URL, or `undefined` when the name is not a coordinate.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function mavenMetadataUrl (base: string, name: string): string | undefined {
  const [groupId = '', artifactId = '', ...rest] = name.split(':')
  if (groupId === '' || artifactId === '' || rest.length > 0) {
    return undefined
  }

  return `${base}/${groupId.replaceAll('.', '/')}/${artifactId}/maven-metadata.xml`
}

/**
 * The newest release a repository's `maven-metadata.xml` names, preferring a stable one.
 *
 * @remarks
 * `<release>` is the newest non-snapshot upload, which can be an alpha or a milestone while a stable line is current, and
 * an update report should not offer a pre-release over the version a team runs on. So the release is used when it is
 * stable, and otherwise the last stable entry of `<versions>`. Versions are in upload order, which is what the repository's own tools
 * rely on for `LATEST`.
 *
 * @param xml - The text of `maven-metadata.xml`.
 * @returns The version, or `undefined` when the metadata names none.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function newestMavenRelease (xml: string): string | undefined {
  const release = /<release>\s*([^<\s]+)\s*<\/release>/.exec(xml)?.[1]
  if (release !== undefined && !PRE_RELEASE.test(release)) {
    return release
  }
  const listed = Array.from(xml.matchAll(/<version>\s*([^<\s]+)\s*<\/version>/g), match => match[1] ?? '')
  const stable = listed.filter(version => !PRE_RELEASE.test(version))

  return stable.at(-1) ?? release ?? listed.at(-1)
}
