import {
  addCatalogLibrary,
  addDependencyLine,
  catalogAccessor,
  catalogAlias,
  readDependencyLines,
  removeCatalogLibrary,
  removeDependencyLines,
} from './gradle-dependency.algorithm'

const CATALOG = [
  '[versions]',
  'kotlin = "2.4.21"',
  '',
  '[libraries]',
  'kotlin-test = { module = "org.jetbrains.kotlin:kotlin-test", version.ref = "kotlin" }',
  '',
  '[plugins]',
  'kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }',
  '',
].join('\n')

const BUILD = [
  'dependencies {',
  '    // mnci:dependencies',
  '    // mnci:dependencies-end',
  '    testImplementation(libs.kotlin.test)',
  '}',
  '',
].join('\n')

describe('catalogAlias and catalogAccessor', () => {
  it('turns an artifact id into a kebab alias and the alias into a libs accessor', () => {
    expect(catalogAlias('Ktor_Server.Core')).toBe('ktor-server-core')
    expect(catalogAccessor('ktor-server-core')).toBe('libs.ktor.server.core')
  })
})

describe('addCatalogLibrary', () => {
  it('appends the library to the [libraries] table, before the next table', () => {
    const { text, alias } = addCatalogLibrary(CATALOG, 'com.google.guava', 'guava', '33.0.0')

    expect(alias).toBe('guava')
    expect(text).toContain('kotlin-test = { module = "org.jetbrains.kotlin:kotlin-test", version.ref = "kotlin" }\nguava = { module = "com.google.guava:guava", version = "33.0.0" }\n')
    expect(text.indexOf('guava =')).toBeLessThan(text.indexOf('[plugins]'))
  })

  it('reuses a library already declared with the same module', () => {
    const first = addCatalogLibrary(CATALOG, 'com.google.guava', 'guava', '33.0.0')
    const second = addCatalogLibrary(first.text, 'com.google.guava', 'guava', '34.0.0')

    expect(second).toEqual({ text: first.text, alias: 'guava' })
  })

  it('prefixes the group when another library holds the alias', () => {
    const first = addCatalogLibrary(CATALOG, 'com.a.one', 'core', '1.0.0')
    const second = addCatalogLibrary(first.text, 'org.b.two', 'core', '2.0.0')

    expect(second.alias).toBe('two-core')
  })

  it('creates the table when the catalog has none', () => {
    const { text } = addCatalogLibrary('[versions]\nkotlin = "2"\n', 'a.b', 'c', '1')

    expect(text).toContain('[libraries]\nc = { module = "a.b:c", version = "1" }\n')
  })
})

describe('removeCatalogLibrary', () => {
  it('removes the entry by alias and leaves the rest', () => {
    const { text } = addCatalogLibrary(CATALOG, 'com.google.guava', 'guava', '33.0.0')

    expect(removeCatalogLibrary(text, 'guava')).toBe(CATALOG)
  })
})

describe('addDependencyLine', () => {
  it('writes the line between the markers, indented like them', () => {
    const { text, refused } = addDependencyLine(BUILD, 'implementation(libs.guava)')

    expect(refused).toBe(false)
    expect(text).toContain('    // mnci:dependencies\n    implementation(libs.guava)\n    // mnci:dependencies-end')
  })

  it('leaves a line that is already there', () => {
    const once = addDependencyLine(BUILD, 'implementation(libs.guava)').text

    expect(addDependencyLine(once, 'implementation(libs.guava)').text).toBe(once)
  })

  it('refuses a build file with no markers instead of guessing', () => {
    expect(addDependencyLine('dependencies {\n}\n', 'implementation(libs.guava)')).toEqual({ text: 'dependencies {\n}\n', refused: true })
  })

  it('keeps the file\'s line endings', () => {
    expect(addDependencyLine(BUILD.replaceAll('\n', '\r\n'), 'implementation(libs.guava)').text).toContain('implementation(libs.guava)\r\n')
  })
})

describe('removeDependencyLines and readDependencyLines', () => {
  it('removes only the matching lines between the markers', () => {
    const built = addDependencyLine(addDependencyLine(BUILD, 'implementation(libs.guava)').text, 'implementation(project(":kit"))').text

    expect(readDependencyLines(built)).toEqual(['implementation(libs.guava)', 'implementation(project(":kit"))'])
    const removed = removeDependencyLines(built, [line => line.includes('project(":kit")')])

    expect(removed.removed).toBe(1)
    expect(readDependencyLines(removed.text)).toEqual(['implementation(libs.guava)'])
    expect(removed.text).toContain('testImplementation(libs.kotlin.test)')
  })

  it('does not touch lines outside the markers', () => {
    expect(removeDependencyLines(BUILD, [line => line.includes('kotlin.test')]).removed).toBe(0)
  })
})
