import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { SLICE_CHECK_SCRIPT } from './native-slice-check.config'
import { nativeSliceCheckTarget } from './native-slice-check-target.algorithm'

let workspace: string
let script: string

/** Writes empty files, and the folders above them. */
function seed (...files: string[]): void {
  for (const file of files) {
    mkdirSync(dirname(join(workspace, file)), { recursive: true })
    writeFileSync(join(workspace, file), '')
  }
}

function run (language: string, project: string): { status: number | null, output: string } {
  const result = spawnSync(process.execPath, [script, language, project], { cwd: workspace, encoding: 'utf8' })

  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'mnci-slice-check-'))
  script = join(workspace, 'slice-check.cjs')
  writeFileSync(script, SLICE_CHECK_SCRIPT)
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('slice-check rust', () => {
  it('accepts the worked example: an entry point, a barrel and role-named files', () => {
    seed('app/src/main.rs', 'app/src/greeting/mod.rs', 'app/src/greeting/greeting_contract.rs', 'app/src/greeting/greet_use_case.rs')

    expect(run('rust', 'app')).toMatchObject({ status: 0 })
  })

  it('rejects a file with no role, a stray file at the root of src, and a junk folder, naming each', () => {
    seed('app/src/main.rs', 'app/src/helpers.rs', 'app/src/greeting/mod.rs', 'app/src/greeting/stuff.rs', 'app/src/util/mod.rs')

    const result = run('rust', 'app')

    expect(result.status).toBe(1)
    expect(result.output).toContain('app/src/helpers.rs - only the entry point sits at the root')
    expect(result.output).toContain('app/src/greeting/stuff.rs - a file is <snake>_<role>.rs')
    expect(result.output).toContain('app/src/util/ - "util" is a junk drawer')
  })

  it('leaves the tool\'s own folders and build.rs alone, since they are outside src', () => {
    seed('app/src/lib.rs', 'app/tests/anything.rs', 'app/build.rs', 'app/benches/bench.rs')

    expect(run('rust', 'app')).toMatchObject({ status: 0 })
  })
})

describe('slice-check cpp', () => {
  it('accepts the worked example: main, a barrel named for its folder, role files and a test', () => {
    seed(
      'app/src/main.cpp',
      'app/src/hello/greeting/greeting.hpp',
      'app/src/hello/greeting/greeting_contract.hpp',
      'app/src/hello/greeting/greet_use_case.cpp',
      'app/src/hello/greeting/greet_use_case_test.cpp',
    )

    expect(run('cpp', 'app')).toMatchObject({ status: 0 })
  })

  it('rejects a file with no role and a second file at the root of src', () => {
    seed('app/src/main.cpp', 'app/src/widget.cpp', 'app/src/hello/greeting/thing.cpp')

    const result = run('cpp', 'app')

    expect(result.status).toBe(1)
    expect(result.output).toContain('app/src/widget.cpp - only the entry point sits at the root')
    expect(result.output).toContain('app/src/hello/greeting/thing.cpp - a file is <snake>_<role>.cpp')
  })

  it('passes for a project with no src folder', () => {
    seed('app/CMakeLists.txt')

    expect(run('cpp', 'app')).toMatchObject({ status: 0 })
  })
})

/** Writes a module pom.xml for a group and artifact. */
function seedPom (project: string, group: string, artifact: string): void {
  mkdirSync(join(workspace, project), { recursive: true })
  writeFileSync(
    join(workspace, project, 'pom.xml'),
    `<project><parent><groupId>x</groupId><artifactId>w</artifactId><version>0</version></parent><groupId>${group}</groupId><artifactId>${artifact}</artifactId></project>`,
  )
}

describe('slice-check java', () => {
  it('accepts the worked example: Main at the root of the base package, role-named types and a test', () => {
    seedPom('app', 'com.example', 'my-app')
    seed(
      'app/src/main/java/com/example/myapp/Main.java',
      'app/src/main/java/com/example/myapp/greeting/GreetUseCase.java',
      'app/src/main/java/com/example/myapp/greeting/GreetingContract.java',
      'app/src/test/java/com/example/myapp/greeting/GreetUseCaseTest.java',
    )

    expect(run('java', 'app')).toMatchObject({ status: 0 })
  })

  it('rejects a type with no role, a stray type at the root, a junk package and a source outside the base package', () => {
    seedPom('app', 'com.example', 'app')
    seed(
      'app/src/main/java/com/example/app/Main.java',
      'app/src/main/java/com/example/app/Helper.java',
      'app/src/main/java/com/example/app/greeting/Stuff.java',
      'app/src/main/java/com/example/app/util/ParseUseCase.java',
      'app/src/main/java/org/other/Elsewhere.java',
    )

    const result = run('java', 'app')

    expect(result.status).toBe(1)
    expect(result.output).toContain('only the entry point sits at the root of the base package')
    expect(result.output).toContain('app/src/main/java/com/example/app/greeting/Stuff.java - a type is <Name><Role>.java')
    expect(result.output).toContain('"util" is a junk drawer')
    expect(result.output).toContain('sources live under the package com.example.app')
  })

  it('passes for a module with no pom.xml or no sources', () => {
    seed('app/README.md')

    expect(run('java', 'app')).toMatchObject({ status: 0 })
  })
})

/** Writes a module build.gradle.kts with a group; the project directory's name is what the package segment comes from. */
function seedBuild (project: string, group: string): void {
  mkdirSync(join(workspace, project), { recursive: true })
  writeFileSync(join(workspace, project, 'build.gradle.kts'), `plugins {}

group = "${group}"
version = "0.1.0"
`)
}

describe('slice-check kotlin', () => {
  it('accepts the worked example: Main at the root of the base package, role-named types and a test', () => {
    seedBuild('apps/my-app', 'com.example')
    seed(
      'apps/my-app/src/main/kotlin/com/example/myapp/Main.kt',
      'apps/my-app/src/main/kotlin/com/example/myapp/greeting/GreetUseCase.kt',
      'apps/my-app/src/main/kotlin/com/example/myapp/greeting/GreetingContract.kt',
      'apps/my-app/src/test/kotlin/com/example/myapp/greeting/GreetUseCaseTest.kt',
    )

    expect(run('kotlin', 'apps/my-app')).toMatchObject({ status: 0 })
  })

  it('rejects a type with no role, a stray type at the root, a junk package and a source outside the base package', () => {
    seedBuild('apps/app', 'com.example')
    seed(
      'apps/app/src/main/kotlin/com/example/app/Main.kt',
      'apps/app/src/main/kotlin/com/example/app/Helper.kt',
      'apps/app/src/main/kotlin/com/example/app/greeting/Stuff.kt',
      'apps/app/src/main/kotlin/com/example/app/util/ParseUseCase.kt',
      'apps/app/src/main/kotlin/org/other/Elsewhere.kt',
    )

    const result = run('kotlin', 'apps/app')

    expect(result.status).toBe(1)
    expect(result.output).toContain('only the entry point sits at the root of the base package')
    expect(result.output).toContain('apps/app/src/main/kotlin/com/example/app/greeting/Stuff.kt - a type is <Name><Role>.kt')
    expect(result.output).toContain('"util" is a junk drawer')
    expect(result.output).toContain('sources live under the package com.example.app')
  })

  it('passes for a project with no build file or no sources', () => {
    seed('apps/app/README.md')

    expect(run('kotlin', 'apps/app')).toMatchObject({ status: 0 })
  })
})

describe('slice-check php', () => {
  it('accepts the worked example: slice folders with role-named classes and a test beside them in tests/', () => {
    seed(
      'app/src/Greeting/GreetUseCase.php',
      'app/src/Greeting/GreetingContract.php',
      'app/tests/Greeting/GreetUseCaseTest.php',
      'app/bin/app.php',
    )

    expect(run('php', 'app')).toMatchObject({ status: 0 })
  })

  it('rejects a class with no role, a file at the root of src, a junk folder and a folder that is not StudlyCase', () => {
    seed(
      'app/src/Helper.php',
      'app/src/Greeting/Stuff.php',
      'app/src/Util/ParseUseCase.php',
      'app/src/lower/ParseUseCase.php',
    )

    const result = run('php', 'app')

    expect(result.status).toBe(1)
    expect(result.output).toContain('nothing sits at the root of src/')
    expect(result.output).toContain('app/src/Greeting/Stuff.php - a class is <Name><Role>.php')
    expect(result.output).toContain('"Util" is a junk drawer')
    expect(result.output).toContain('a slice folder is StudlyCase')
  })

  it('allows one SmokeTest at the root of tests/, as a bare project keeps', () => {
    seed('app/tests/SmokeTest.php')

    expect(run('php', 'app')).toMatchObject({ status: 0 })
  })
})

describe('slice-check ruby', () => {
  it('accepts the worked example: the barrel, a version, slice folders of role-named files and a mirrored spec', () => {
    seed(
      'app/lib/my_kit.rb',
      'app/lib/my_kit/version.rb',
      'app/lib/my_kit/greeting/greeting_contract.rb',
      'app/lib/my_kit/greeting/greet_use_case.rb',
      'app/spec/spec_helper.rb',
      'app/spec/greeting/greet_use_case_spec.rb',
    )

    expect(run('ruby', 'app')).toMatchObject({ status: 0 })
  })

  it('rejects a file with no role, a stray file at the root of lib, a junk folder and a spec with no role', () => {
    seed(
      'app/lib/my_kit.rb',
      'app/lib/my_kit/helpers.rb',
      'app/lib/my_kit/greeting/stuff.rb',
      'app/lib/my_kit/util/parse_use_case.rb',
      'app/lib/loose.rb',
      'app/spec/stuff_spec.rb',
    )

    const result = run('ruby', 'app')

    expect(result.status).toBe(1)
    expect(result.output).toContain('app/lib/loose.rb - only the barrel')
    expect(result.output).toContain('app/lib/my_kit/helpers.rb - a file is <snake>_<role>.rb')
    expect(result.output).toContain('app/lib/my_kit/greeting/stuff.rb - a file is <snake>_<role>.rb')
    expect(result.output).toContain('"util" is a junk drawer')
    expect(result.output).toContain('app/spec/stuff_spec.rb - a spec is <snake>_<role>_spec.rb')
  })

  it('allows the smoke spec a bare project keeps', () => {
    seed('app/lib/kit.rb', 'app/lib/kit/version.rb', 'app/spec/spec_helper.rb', 'app/spec/smoke_spec.rb')

    expect(run('ruby', 'app')).toMatchObject({ status: 0 })
  })
})

describe('slice-check usage', () => {
  it('refuses an unknown language', () => {
    expect(run('swift', 'app').status).toBe(1)
  })

  it('has a cached target keyed on the sources and the script', () => {
    expect(nativeSliceCheckTarget('rust', 'apps/hello')).toEqual({
      executor: 'nx:run-commands',
      cache:    true,
      inputs:   ['{projectRoot}/src/**/*', '{projectRoot}/pom.xml', '{projectRoot}/build.gradle.kts', '{workspaceRoot}/tools/slice-check.cjs'],
      options:  { command: 'node tools/slice-check.cjs rust apps/hello' },
    })
  })
})
