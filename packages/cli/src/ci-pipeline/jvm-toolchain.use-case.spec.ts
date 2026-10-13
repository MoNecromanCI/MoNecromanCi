// Reached through the overlay barrel (pinned tool versions), which loads the prompts: ESM-only, unparseable by jest as CJS.
jest.mock('@inquirer/prompts', () => ({ confirm: jest.fn(), input: jest.fn(), select: jest.fn(), checkbox: jest.fn(), Separator: class {} }))

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { GRADLE_VERSION, JAVA_VERSION } from '../workspace-overlay'
import { prepareJvmToolchain } from './jvm-toolchain.use-case'
import type { CiProcesses } from './phase.contract'

let root: string
let jdk: string
let envFile: string

/** Writes a file under the workspace. */
function seed (relative: string, contents = ''): void {
  mkdirSync(dirname(join(root, relative)), { recursive: true })
  writeFileSync(join(root, relative), contents)
}

/** A runner whose captures answer from a table of command line to status and output. */
function processes (answers: Record<string, { status: number, stdout?: string }>): CiProcesses {
  return {
    run:     () => 0,
    capture: (command, arguments_) => {
      const answer = answers[[command, ...arguments_].join(' ')] ?? { status: 1 }

      return { status: answer.status, stdout: answer.stdout ?? '' }
    },
  }
}

const architecture = process.arch === 'arm64' ? 'ARM64' : 'X64'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-jvm-'))
  jdk = mkdtempSync(join(tmpdir(), 'mnci-jdk-'))
  envFile = join(tmpdir(), `mnci-env-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  writeFileSync(envFile, '')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(jdk, { recursive: true, force: true })
  rmSync(envFile, { force: true })
})

describe('prepareJvmToolchain', () => {
  it('does nothing for a workspace with no Maven or Gradle project', () => {
    const logged: string[] = []

    expect(prepareJvmToolchain(root, 'local', {}, processes({}), message => { logged.push(message) })).toBe(0)
    expect(logged).toEqual(['No Java, Kotlin or Android projects - skipping.'])
  })

  it('selects the pinned JDK for the next steps on GitHub, through GITHUB_ENV and GITHUB_PATH', () => {
    seed('libs/kit/pom.xml', '<project/>')
    const pathFile = `${envFile}.path`
    writeFileSync(pathFile, '')
    const environment = { [`JAVA_HOME_${JAVA_VERSION}_${architecture}`]: jdk, GITHUB_ENV: envFile, GITHUB_PATH: pathFile }

    prepareJvmToolchain(root, 'github', environment, processes({ 'mvn --version': { status: 0 } }), () => {})

    expect(readFileSync(envFile, 'utf8')).toBe(`JAVA_HOME=${jdk}\n`)
    expect(readFileSync(pathFile, 'utf8')).toContain(join(jdk, 'bin'))
    rmSync(pathFile, { force: true })
  })

  it('selects it with the logging commands on Azure', () => {
    seed('libs/kit/pom.xml', '<project/>')
    const logged: string[] = []

    prepareJvmToolchain(root, 'azure', { [`JAVA_HOME_${JAVA_VERSION}_${architecture}`]: jdk }, processes({ 'mvn --version': { status: 0 } }), message => { logged.push(message) })

    expect(logged).toContain(`##vso[task.setvariable variable=JAVA_HOME]${jdk}`)
    expect(logged).toContain(`##vso[task.prependpath]${join(jdk, 'bin')}`)
  })

  it('warns, and still passes, when no JDK can be found', () => {
    seed('libs/kit/pom.xml', '<project/>')
    const logged: string[] = []

    expect(prepareJvmToolchain(root, 'local', {}, processes({ 'mvn --version': { status: 0 } }), message => { logged.push(message) })).toBe(0)
    expect(logged.some(line => line.includes(`no JDK ${JAVA_VERSION} was found`))).toBe(true)
  })

  it('names a Gradle that is missing or older than the one the projects were verified with', () => {
    seed('libs/kit/build.gradle.kts', 'plugins { }')
    const missing: string[] = []
    const older: string[] = []

    prepareJvmToolchain(root, 'local', { JAVA_HOME: jdk }, processes({ 'java -version': { status: 0 } }), message => { missing.push(message) })
    prepareJvmToolchain(root, 'local', {}, processes({ 'java -version': { status: 0 }, 'gradle --version': { status: 0, stdout: 'Gradle 8.14.3\n' } }), message => { older.push(message) })

    expect(missing.some(line => line.includes('Gradle was not found'))).toBe(true)
    expect(older.some(line => line.includes(`older than ${GRADLE_VERSION}`))).toBe(true)
  })

  it('is quiet about a Gradle at least as new as the pin', () => {
    seed('libs/kit/build.gradle.kts', 'plugins { }')
    const logged: string[] = []

    prepareJvmToolchain(root, 'local', {}, processes({ 'java -version': { status: 0 }, 'gradle --version': { status: 0, stdout: `Gradle ${GRADLE_VERSION}\n` } }), message => { logged.push(message) })

    expect(logged).toEqual([])
  })

  it('names the sdkmanager commands for an Android project with no SDK, and never runs them', () => {
    seed('apps/hello/build.gradle.kts', 'plugins { alias(libs.plugins.android.application) }\n// com.android')
    const logged: string[] = []

    prepareJvmToolchain(root, 'local', {}, processes({ 'java -version': { status: 0 }, 'gradle --version': { status: 0, stdout: `Gradle ${GRADLE_VERSION}\n` } }), message => { logged.push(message) })

    const warning = logged.find(line => line.includes('ANDROID_HOME'))
    expect(warning).toContain('sdkmanager --licenses')
    expect(warning).toContain('never accepts')
  })
})
