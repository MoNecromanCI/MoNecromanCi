import {
  addMavenDependency,
  mavenDependencies,
  mavenModuleIdentity,
  parseMavenCoordinate,
  removeMavenDependency,
} from './maven-dependency.algorithm'

const POM = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.example</groupId>
    <artifactId>workspace</artifactId>
    <version>0.0.0</version>
    <relativePath>../../pom.xml</relativePath>
  </parent>

  <artifactId>hello</artifactId>
  <version>0.1.0</version>

  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <artifactId>maven-shade-plugin</artifactId>
        <dependencies>
          <dependency>
            <groupId>org.example</groupId>
            <artifactId>shade-helper</artifactId>
            <version>1</version>
          </dependency>
        </dependencies>
      </plugin>
    </plugins>
  </build>
</project>
`

describe('parseMavenCoordinate', () => {
  it('reads group:artifact with a version after @ or a second colon', () => {
    expect(parseMavenCoordinate('com.google.guava:guava')).toEqual({ groupId: 'com.google.guava', artifactId: 'guava' })
    expect(parseMavenCoordinate('com.google.guava:guava@33.0.0')).toEqual({ groupId: 'com.google.guava', artifactId: 'guava', version: '33.0.0' })
    expect(parseMavenCoordinate('com.google.guava:guava:33.0.0')).toEqual({ groupId: 'com.google.guava', artifactId: 'guava', version: '33.0.0' })
  })

  it('refuses a bare word, an empty part and a trailing @', () => {
    expect(parseMavenCoordinate('guava')).toBeUndefined()
    expect(parseMavenCoordinate('com.google.guava:')).toBeUndefined()
    expect(parseMavenCoordinate('a:b@')).toBeUndefined()
  })
})

describe('mavenModuleIdentity', () => {
  it('reads the module own version, not the parent', () => {
    expect(mavenModuleIdentity(POM)).toEqual({ groupId: 'com.example', artifactId: 'hello', version: '0.1.0' })
  })
})

describe('mavenDependencies', () => {
  it('reads only the module own dependencies, never a plugin one', () => {
    expect(mavenDependencies(POM)).toEqual([{ groupId: 'org.junit.jupiter', artifactId: 'junit-jupiter' }])
  })
})

describe('addMavenDependency', () => {
  const guava = { groupId: 'com.google.guava', artifactId: 'guava', version: '33.0.0' }

  it('adds the block before the closing tag, indented to match', () => {
    const next = addMavenDependency(POM, guava)

    expect(next).toContain(`    <dependency>
      <groupId>com.google.guava</groupId>
      <artifactId>guava</artifactId>
      <version>33.0.0</version>
    </dependency>
  </dependencies>`)
    expect(mavenDependencies(next).map(dependency => dependency.artifactId)).toEqual(['junit-jupiter', 'guava'])
  })

  it('writes a scope when given one', () => {
    expect(addMavenDependency(POM, { ...guava, scope: 'test' })).toContain('<scope>test</scope>\n    </dependency>\n  </dependencies>')
  })

  it('is idempotent on group and artifact, whatever the declared version', () => {
    const once = addMavenDependency(POM, guava)

    expect(addMavenDependency(once, { ...guava, version: '1.0.0' })).toBe(once)
  })

  it('creates the dependencies block before build when the module has none', () => {
    const bare = POM.replace(/ {2}<dependencies>[\s\S]*?<\/dependencies>\n\n {2}<build>/, '  <build>')
    const next = addMavenDependency(bare, guava)

    expect(next.indexOf('<dependencies>')).toBeLessThan(next.indexOf('<build>'))
    expect(mavenDependencies(next)).toEqual([{ groupId: 'com.google.guava', artifactId: 'guava' }])
  })

  it('keeps CRLF line endings', () => {
    const next = addMavenDependency(POM.replaceAll('\n', '\r\n'), guava)

    expect(next).not.toMatch(/[^\r]\n/)
  })
})

describe('removeMavenDependency', () => {
  it('removes by group:artifact and by a unique artifact id', () => {
    const withGuava = addMavenDependency(POM, { groupId: 'com.google.guava', artifactId: 'guava', version: '33.0.0' })

    expect(removeMavenDependency(withGuava, 'com.google.guava:guava')).toEqual({ text: POM, removed: true })
    expect(removeMavenDependency(withGuava, 'guava')).toEqual({ text: POM, removed: true })
  })

  it('leaves the text alone for an unknown dependency and for a plugin one', () => {
    expect(removeMavenDependency(POM, 'nothing')).toEqual({ text: POM, removed: false })
    expect(removeMavenDependency(POM, 'org.example:shade-helper')).toEqual({ text: POM, removed: false })
  })

  it('refuses an artifact id that two dependencies share', () => {
    const twice = addMavenDependency(
      addMavenDependency(POM, { groupId: 'a.one', artifactId: 'core', version: '1' }),
      { groupId: 'b.two', artifactId: 'core', version: '1' },
    )

    expect(removeMavenDependency(twice, 'core').removed).toBe(false)
    expect(removeMavenDependency(twice, 'a.one:core').removed).toBe(true)
  })
})
