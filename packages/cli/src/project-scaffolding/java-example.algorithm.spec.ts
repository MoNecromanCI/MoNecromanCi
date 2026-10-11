import {
  addMavenModule,
  javaEmptyFiles,
  javaExampleFiles,
  javaGroupId,
  javaModulePom,
  javaPackageSegment,
  javaRootPom,
} from './java-example.algorithm'

describe('javaGroupId', () => {
  it('reverses the host and keeps the organisation, lowercased', () => {
    expect(javaGroupId('github.com/MoNecromanCI/mnci')).toBe('com.github.monecromanci')
  })

  it('falls back to com.example without an origin or with one that is not host/org', () => {
    expect(javaGroupId(undefined)).toBe('com.example')
    expect(javaGroupId('localhost')).toBe('com.example')
  })
})

describe('javaPackageSegment', () => {
  it('drops everything that is not a letter or digit', () => {
    expect(javaPackageSegment('My-Tool_2')).toBe('mytool2')
  })

  it('keeps a leading digit legal', () => {
    expect(javaPackageSegment('3d-kit')).toBe('_3dkit')
  })
})

describe('the aggregator pom.xml', () => {
  it('lists the modules and pins the plugin and test-library versions once', () => {
    const pom = javaRootPom('com.example', ['apps/hello', 'libs/kit'])

    expect(pom).toContain('<module>apps/hello</module>')
    expect(pom).toContain('<module>libs/kit</module>')
    expect(pom).toContain('<groupId>org.junit</groupId>')
    expect(pom).toContain('<failOnWarning>true</failOnWarning>')
    expect(pom).toContain('<configLocation>tools/checkstyle.xml</configLocation>')
  })

  it('adds a module once and leaves a listed one alone', () => {
    const pom = javaRootPom('com.example', ['apps/hello'])
    const added = addMavenModule(pom, 'libs/kit')

    expect(added).toContain('<module>libs/kit</module>')
    expect(addMavenModule(added, 'libs/kit')).toBe(added)
    expect(added.indexOf('<module>apps/hello</module>')).toBeLessThan(added.indexOf('<module>libs/kit</module>'))
  })
})

describe('a module pom.xml', () => {
  it('names no plugin or test-library version of its own, and inherits the aggregator', () => {
    const pom = javaModulePom('java-lib', 'com.example', 'kit', undefined)

    expect(pom).toContain('<relativePath>../../pom.xml</relativePath>')
    expect(pom).toContain('<artifactId>kit</artifactId>')
    expect(pom).not.toContain('maven-shade-plugin')
    expect(pom).not.toMatch(/junit-jupiter<\/artifactId>\s*<version>/)
  })

  it('shades an app into one jar named after it, with its main class', () => {
    const pom = javaModulePom('java-app', 'com.example', 'hello', 'com.example.hello.Main')

    expect(pom).toContain('<finalName>hello</finalName>')
    expect(pom).toContain('<mainClass>com.example.hello.Main</mainClass>')
  })
})

describe('the worked example', () => {
  it('puts the slice in a package, with the role in the type name and a test beside it', () => {
    const files = javaExampleFiles('java-lib', 'com.example', 'my-kit')

    expect(Object.keys(files)).toHaveLength(3)
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      'src/main/java/com/example/mykit/greeting/GreetUseCase.java',
      'src/main/java/com/example/mykit/greeting/GreetingContract.java',
      'src/test/java/com/example/mykit/greeting/GreetUseCaseTest.java',
    ]))
    expect(files['src/main/java/com/example/mykit/greeting/GreetUseCase.java']).toContain('package com.example.mykit.greeting;')
  })

  it('gives an app a Main at the root of its base package that only wires', () => {
    const files = javaExampleFiles('java-app', 'com.example', 'hello')

    expect(files['src/main/java/com/example/hello/Main.java']).toContain('GreetUseCase.greet("hello")')
  })

  it('writes an entry point that does nothing for a bare app, and no source for a bare library', () => {
    expect(Object.keys(javaEmptyFiles('java-app', 'com.example', 'hello'))).toEqual(['src/main/java/com/example/hello/Main.java'])
    expect(javaEmptyFiles('java-lib', 'com.example', 'kit')).toEqual({})
  })
})
