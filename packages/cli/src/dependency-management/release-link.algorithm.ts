import type { Ecosystem } from './manifest.repository'

/**
 * The page that describes one release of a package: the place to read what changed before updating.
 *
 * @remarks
 * Built from the package name and version alone, so it costs no registry call and works offline. Each address is the
 * ecosystem's own registry page for that version, which links on to the changelog or the repository. An ecosystem with
 * no registry page of its own (CMake, Gradle's catalog) has none.
 *
 * @param ecosystem - The package's ecosystem.
 * @param name - The package name as the manifest spells it (`group:artifact` for Maven).
 * @param version - The release, with or without a leading `v`.
 * @returns The address, or `undefined` when the ecosystem has no page to point at.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function releaseLink (ecosystem: Ecosystem, name: string, version: string): string | undefined {
  const bare = version.replace(/^v/, '')
  switch (ecosystem) {
    case 'npm': {
      return `https://www.npmjs.com/package/${name}/v/${bare}`
    }
    case 'pip': {
      return `https://pypi.org/project/${encodeURIComponent(name)}/${bare}/`
    }
    case 'pub': {
      return `https://pub.dev/packages/${name}/changelog`
    }
    case 'nuget': {
      return `https://www.nuget.org/packages/${name}/${bare}`
    }
    case 'cargo': {
      return `https://crates.io/crates/${name}/${bare}`
    }
    case 'go': {
      return `https://pkg.go.dev/${name}@v${bare}`
    }
    case 'bundler': {
      return `https://rubygems.org/gems/${name}/versions/${bare}`
    }
    case 'composer': {
      return `https://packagist.org/packages/${name}#${bare}`
    }
    case 'maven': {
      const [group, artifact] = name.split(':', 2)

      return artifact === undefined ? undefined : `https://central.sonatype.com/artifact/${group}/${artifact}/${bare}`
    }
    default: {
      return undefined
    }
  }
}
