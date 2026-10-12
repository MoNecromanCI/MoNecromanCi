import { releaseLink } from './release-link.algorithm'

describe('releaseLink', () => {
  it('points an npm package, scoped or not, at the page of that version', () => {
    expect(releaseLink('npm', '@nx/js', '23.3.0')).toBe('https://www.npmjs.com/package/@nx/js/v/23.3.0')
    expect(releaseLink('npm', 'ts-node', '10.9.2')).toBe('https://www.npmjs.com/package/ts-node/v/10.9.2')
  })

  it('drops a leading v, which Go versions carry', () => {
    expect(releaseLink('go', 'github.com/spf13/cobra', 'v1.9.0')).toBe('https://pkg.go.dev/github.com/spf13/cobra@v1.9.0')
    expect(releaseLink('go', 'github.com/spf13/cobra', '1.9.0')).toBe('https://pkg.go.dev/github.com/spf13/cobra@v1.9.0')
  })

  it('builds the registry page of every other ecosystem', () => {
    expect(releaseLink('pip', 'ruff', '0.9.0')).toBe('https://pypi.org/project/ruff/0.9.0/')
    expect(releaseLink('pub', 'http', '1.2.0')).toBe('https://pub.dev/packages/http/changelog')
    expect(releaseLink('nuget', 'Newtonsoft.Json', '13.0.3')).toBe('https://www.nuget.org/packages/Newtonsoft.Json/13.0.3')
    expect(releaseLink('cargo', 'serde', '1.0.200')).toBe('https://crates.io/crates/serde/1.0.200')
    expect(releaseLink('bundler', 'rake', '13.2.1')).toBe('https://rubygems.org/gems/rake/versions/13.2.1')
    expect(releaseLink('composer', 'monolog/monolog', '3.8.0')).toBe('https://packagist.org/packages/monolog/monolog#3.8.0')
    expect(releaseLink('maven', 'com.google.guava:guava', '33.0.0')).toBe('https://central.sonatype.com/artifact/com.google.guava/guava/33.0.0')
  })

  it('has no page for an ecosystem without a registry, or a Maven name with no artifact', () => {
    expect(releaseLink('cmake', 'fmt', '11.0.0')).toBeUndefined()
    expect(releaseLink('gradle', 'x', '1')).toBeUndefined()
    expect(releaseLink('maven', 'guava', '33.0.0')).toBeUndefined()
  })
})
