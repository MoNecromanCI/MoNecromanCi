import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, writeFileEnsured } from '../file-system'
import { goModulePrefix } from '../go-workspace'
import { logger } from '../terminal'
import { runCapture } from '../nx-workspace'
import { nativeSliceCheckTarget, SLICE_CHECK_PATH, SLICE_CHECK_SCRIPT } from '../native-slice-check'
import { CHECKSTYLE_CONFIG, CHECKSTYLE_CONFIG_PATH } from './java-build.config'
import {
  addMavenModule,
  javaEmptyFiles,
  javaExampleFiles,
  javaGroupId,
  type JavaKind,
  javaModulePom,
  javaPackageSegment,
  javaRootPom,
} from './java-example.algorithm'
import { wireJavaLibRelease } from './java-release.use-case'
import { addProjectJsonTargets, ensureAdmZip, registerProjectCommands } from './post-generation.use-case'

/** Where each kind's project lives: apps under `apps/`, publishable libraries under `packages/`, private ones under `libs/`. */
const JAVA_DIRECTORIES: Readonly<Record<JavaKind, string>> = {
  'java-app':          'apps',
  'java-lib':          'packages',
  'java-internal-lib': 'libs',
}

/** The Maven invocation every target shares: batch mode, no download progress, from the workspace root. */
const MVN = 'mvn -B -ntp'

/**
 * The targets of a Java project, written explicitly because nothing infers them.
 *
 * @remarks
 * `-pl <module> -am` builds the module together with the siblings it depends on from the aggregator's reactor, so an
 * internal library needs no `mvn install` into the local repository first. Each module builds into its own
 * `dist/maven/<name>` (its `pom.xml` sets `<build><directory>`), like Rust's `dist/target/<name>` and CMake's
 * `dist/cmake/<name>`: nothing lands beside the sources for git to pick up, and Nx's output clearing on a cache restore
 * cannot touch another project. `javac` compiles with debug
 * information by default, so `build` is the build a debugger wants and there is no `build-dev`. `lint` is Checkstyle,
 * after the compiler's own `-Xlint:all` and `failOnWarning`, which is part of `build`. There is no `typecheck`: compiling
 * is the check.
 *
 * `-am` makes each Maven run compile the siblings too, into their own directories, so two runs at once would write the same
 * `dist/maven/<name>` and one would delete the classes the other is reading (measured: `hello:build` failed to find a
 * class while `hello:test` ran). `build` therefore waits for the builds of what the project depends on (`^build`, which
 * is why an installed sibling is recorded as an `implicitDependencies` edge) and `test` waits for `build`, as the other
 * kinds' do, so the `mvn` that follows finds the classes already compiled.
 *
 * @param name - The project name.
 * @param directory - The project's workspace-relative directory.
 * @param app - Whether the project builds an executable jar.
 * @returns The Nx targets to merge into the project's `project.json`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function javaTargets (name: string, directory: string, app: boolean): Record<string, unknown> {
  const output = `dist/maven/${name}`
  const jar = `${output}/${name}.jar`
  const targets: Record<string, unknown> = {
    'build': {
      cache:     true,
      executor:  'nx:run-commands',
      dependsOn: ['^build'],
      inputs:    ['default', '^default', '{workspaceRoot}/pom.xml'],
      outputs:   [`{workspaceRoot}/${output}`],
      options:   { command: `${MVN} -pl ${directory} -am package -DskipTests` },
    },
    'test': {
      cache:     true,
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      inputs:    ['default', '^default', '{workspaceRoot}/pom.xml'],
      options:   { command: `${MVN} -pl ${directory} -am test` },
    },
    'slice-check': nativeSliceCheckTarget('java', directory),
    'lint':        {
      cache:     true,
      executor:  'nx:run-commands',
      dependsOn: ['slice-check'],
      inputs:    ['default', `{workspaceRoot}/${CHECKSTYLE_CONFIG_PATH}`],
      options:   {
        command: `${MVN} -pl ${directory} checkstyle:check -Dcheckstyle.includeTestSourceDirectory=true`,
      },
    },
  }
  if (app) {
    targets.start = {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      options:   {
        command: `node -e "const r=require('node:child_process').spawnSync('java',['-jar','${jar}'],{stdio:'inherit'});process.exit(r.status??1)"`,
      },
    }
    targets.package = {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      outputs:   [`{workspaceRoot}/dist/drop/java-app-${name}.zip`],
      options:   {
        command: `node -e "const fs=require('node:fs');fs.mkdirSync('dist/drop',{recursive:true});const A=require('adm-zip');const z=new A();z.addLocalFile('${jar}');z.writeZip('dist/drop/java-app-${name}.zip')"`,
      },
    }
  }

  return targets
}

/**
 * Puts the new module in the workspace's aggregator `pom.xml`, writing the aggregator on the first project.
 *
 * @remarks
 * The `groupId` of an existing aggregator is kept: it is read back by the module poms, so a repository origin that changed
 * since the first project does not split the workspace in two namespaces.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param directory - The module's workspace-relative directory.
 * @param groupId - The `groupId` to use when the aggregator does not exist yet.
 * @returns The `groupId` the aggregator carries.
 * @throws Error when a file cannot be read or written.
 * @typeParam None - this function has no generic type parameters.
 */
function registerJavaModule (workspaceRoot: string, directory: string, groupId: string): string {
  const rootPom = join(workspaceRoot, 'pom.xml')
  if (!fileExists(rootPom)) {
    writeFileEnsured(rootPom, javaRootPom(groupId, [directory]))

    return groupId
  }
  const text = readFileSync(rootPom, 'utf8')
  writeFileEnsured(rootPom, addMavenModule(text, directory))

  return /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(text.replace(/<parent>[\s\S]*?<\/parent>/, ''))?.[1] ?? groupId
}

/**
 * Adds a Java project: a Maven module with a worked example, explicit targets and, for a library, release by tag.
 *
 * @remarks
 * `@nx/maven` is inference-only (it ships no project generator), and the community `@jnxplus` plugins pin their own idea of
 * a layout, so mnci writes the module as it writes a C++ or Bicep project, with Maven as the build tool (Gradle is a
 * separate piece of work, #470). The module's dependencies are its own `pom.xml`; the aggregator at the root carries only
 * plugin and test-library versions and the module list.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param kind - Which Java kind.
 * @param empty - Scaffold a bare project (`--empty`).
 * @returns Nothing.
 * @throws Error when a file cannot be written.
 * @typeParam None - this function has no generic type parameters.
 */
export function addJavaProject (workspaceRoot: string, name: string, kind: JavaKind, empty = false): void {
  const app = kind === 'java-app'
  const directory = `${JAVA_DIRECTORIES[kind]}/${name}`
  const projectRoot = join(workspaceRoot, directory)
  if (app) {
    ensureAdmZip(workspaceRoot)
  }
  const groupId = registerJavaModule(workspaceRoot, directory, javaGroupId(goModulePrefix(workspaceRoot)))
  const entryPoint = app ? `${groupId}.${javaPackageSegment(name)}.Main` : undefined

  writeFileEnsured(join(projectRoot, 'pom.xml'), javaModulePom(kind, groupId, name, entryPoint))
  const files = empty ? javaEmptyFiles(kind, groupId, name) : javaExampleFiles(kind, groupId, name)
  for (const [relative, contents] of Object.entries(files)) {
    writeFileEnsured(join(projectRoot, relative), contents)
  }
  writeFileEnsured(
    join(projectRoot, 'project.json'),
    `${JSON.stringify({
      name,
      $schema:     '../../node_modules/nx/schemas/project-schema.json',
      projectType: app ? 'application' : 'library',
      sourceRoot:  `${directory}/src/main/java`,
      tags:        [`type:${kind}`],
      targets:     {},
    }, undefined, 2)}\n`,
  )
  writeFileEnsured(join(workspaceRoot, SLICE_CHECK_PATH), SLICE_CHECK_SCRIPT)
  writeFileEnsured(join(workspaceRoot, CHECKSTYLE_CONFIG_PATH), CHECKSTYLE_CONFIG)
  addProjectJsonTargets(join(projectRoot, 'project.json'), javaTargets(name, directory, app))
  if (kind === 'java-lib') {
    wireJavaLibRelease(workspaceRoot, directory, name)
  }
  registerProjectCommands(workspaceRoot, name, app
    ? { build: true, start: `nx run ${name}:start`, debug: { language: 'jvm', mainClass: `${groupId}.${javaPackageSegment(name)}.Main` } }
    : { build: kind === 'java-lib' })

  if (runCapture('mvn', ['-v'], workspaceRoot).status !== 0) {
    logger.warn('mvn is not on PATH, and every Java target runs it. Install Maven 3.9 or newer and a JDK 21 or newer (winget, apt, brew, sdkman).')
  }
}
