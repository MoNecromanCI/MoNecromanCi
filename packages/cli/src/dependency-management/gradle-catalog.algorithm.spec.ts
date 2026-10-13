import { catalogLibraries, replaceCatalogVersion } from './gradle-catalog.algorithm'

const CATALOG = [
  '[versions]',
  'ktor = "3.0.0"',
  'kotlin = "2.4.21"',
  'range = "[1.0,2.0)"',
  '',
  '[libraries]',
  'ktor-server-core = { module = "io.ktor:ktor-server-core", version.ref = "ktor" }',
  'ktor-server-netty = { module = "io.ktor:ktor-server-netty", version = { ref = "ktor" } }',
  'guava = { module = "com.google.guava:guava", version = "33.0.0-jre" }',
  'junit = "junit:junit:4.13.2"',
  'okio = { group = "com.squareup.okio", name = "okio", version = "3.9.0" }',
  'compose-bom = { module = "androidx.compose:compose-bom", version = "2026.09.00" }',
  'compose-ui = { module = "androidx.compose.ui:ui" }',
  'kotlin-stdlib = { module = "org.jetbrains.kotlin:kotlin-stdlib", version.ref = "kotlin" }',
  'ranged = { module = "org.example:ranged", version.ref = "range" }',
  'missing = { module = "org.example:missing", version.ref = "nowhere" }',
  '',
  '[plugins]',
  'kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }',
  '',
].join('\n')

describe('catalogLibraries', () => {
  it('reads every form of a library that names a comparable version', () => {
    const found = catalogLibraries(CATALOG)

    expect(found.map(entry => [entry.alias, entry.module, entry.version])).toEqual([
      ['ktor-server-core', 'io.ktor:ktor-server-core', '3.0.0'],
      ['ktor-server-netty', 'io.ktor:ktor-server-netty', '3.0.0'],
      ['guava', 'com.google.guava:guava', '33.0.0-jre'],
      ['junit', 'junit:junit', '4.13.2'],
      ['okio', 'com.squareup.okio:okio', '3.9.0'],
      ['compose-bom', 'androidx.compose:compose-bom', '2026.09.00'],
      ['kotlin-stdlib', 'org.jetbrains.kotlin:kotlin-stdlib', '2.4.21'],
    ])
  })

  it('leaves a BOM-managed library, a range and a dangling reference out', () => {
    const aliases = catalogLibraries(CATALOG).map(entry => entry.alias)

    expect(aliases).not.toContain('compose-ui')
    expect(aliases).not.toContain('ranged')
    expect(aliases).not.toContain('missing')
  })

  it('marks a reference shared with another entry as not rewritable', () => {
    const byAlias = Object.fromEntries(catalogLibraries(CATALOG).map(entry => [entry.alias, entry.rewritable]))

    expect(byAlias['guava']).toBe(true)
    expect(byAlias['ktor-server-core']).toBe(false)
    expect(byAlias['kotlin-stdlib']).toBe(false)
  })
})

describe('replaceCatalogVersion', () => {
  it('replaces a literal version on its own line, in each form', () => {
    expect(replaceCatalogVersion(CATALOG, 'com.google.guava:guava', '33.4.0-jre')).toBe(CATALOG.replace('33.0.0-jre', '33.4.0-jre'))
    expect(replaceCatalogVersion(CATALOG, 'junit:junit', '4.13.3')).toBe(CATALOG.replace('junit:junit:4.13.2', 'junit:junit:4.13.3'))
    expect(replaceCatalogVersion(CATALOG, 'com.squareup.okio:okio', '3.10.0')).toBe(CATALOG.replace('"3.9.0"', '"3.10.0"'))
  })

  it('replaces the [versions] entry of a reference used once', () => {
    const catalog = ['[versions]', 'guava = "33.0.0-jre"', '', '[libraries]', 'guava = { module = "com.google.guava:guava", version.ref = "guava" }', ''].join('\n')

    expect(replaceCatalogVersion(catalog, 'com.google.guava:guava', '33.4.0-jre')).toBe(catalog.replace('"33.0.0-jre"', '"33.4.0-jre"'))
  })

  it('leaves a shared reference, an unknown module and a BOM-managed library alone', () => {
    expect(replaceCatalogVersion(CATALOG, 'io.ktor:ktor-server-core', '3.1.0')).toBe(CATALOG)
    expect(replaceCatalogVersion(CATALOG, 'no.such:thing', '1.0.0')).toBe(CATALOG)
    expect(replaceCatalogVersion(CATALOG, 'androidx.compose.ui:ui', '1.0.0')).toBe(CATALOG)
  })

  it('keeps CRLF line endings', () => {
    const crlf = CATALOG.replaceAll('\n', '\r\n')

    expect(replaceCatalogVersion(crlf, 'com.google.guava:guava', '33.4.0-jre')).toBe(crlf.replace('33.0.0-jre', '33.4.0-jre'))
  })
})
