import { mavenMetadataUrl, newestMavenRelease } from './maven-metadata.algorithm'

const metadata = (release: string | undefined, versions: string[]): string =>
  `<metadata><versioning>${release === undefined ? '' : `<release>${release}</release>`}` +
  `<versions>${versions.map(version => `<version>${version}</version>`).join('')}</versions></versioning></metadata>`

describe('mavenMetadataUrl', () => {
  it('lays a coordinate out as the repository does', () => {
    expect(mavenMetadataUrl('https://repo', 'com.google.guava:guava')).toBe('https://repo/com/google/guava/guava/maven-metadata.xml')
  })

  it('refuses a name that is not group:artifact', () => {
    expect(mavenMetadataUrl('https://repo', 'guava')).toBeUndefined()
    expect(mavenMetadataUrl('https://repo', 'a:b:c')).toBeUndefined()
    expect(mavenMetadataUrl('https://repo', ':b')).toBeUndefined()
  })
})

describe('newestMavenRelease', () => {
  it('uses the release when it is stable', () => {
    expect(newestMavenRelease(metadata('33.4.0-jre', ['33.3.0-jre', '33.4.0-jre']))).toBe('33.4.0-jre')
  })

  it('prefers the last stable entry over a pre-release named as the release', () => {
    expect(newestMavenRelease(metadata('4.0.0-alpha1', ['3.9.0', '3.9.1', '4.0.0-alpha1']))).toBe('3.9.1')
  })

  it('falls back to the pre-release when nothing stable exists, and to nothing for empty metadata', () => {
    expect(newestMavenRelease(metadata('1.0.0-RC1', ['1.0.0-RC1']))).toBe('1.0.0-RC1')
    expect(newestMavenRelease('<metadata/>')).toBeUndefined()
  })

  it('reads the last listed version when there is no release element', () => {
    expect(newestMavenRelease(metadata(undefined, ['1.0.0', '1.1.0']))).toBe('1.1.0')
  })
})
