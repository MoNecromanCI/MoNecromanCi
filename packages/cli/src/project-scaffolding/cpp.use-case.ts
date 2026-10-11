import { join } from 'node:path'
import { writeFileEnsured } from '../file-system'
import { logger } from '../terminal'
import { runCapture } from '../nx-workspace'
import { type CppKind, cppCmakeLists, cppEmptyFiles, cppExampleFiles } from './cpp-example.algorithm'
import { wireCppLibRelease } from './cpp-release.use-case'
import { addProjectJsonTargets, ensureAdmZip, registerProjectCommands } from './post-generation.use-case'

/** Where each kind's project lives: apps under `apps/`, publishable libraries under `packages/`, private ones under `libs/`. */
const CPP_DIRECTORIES: Readonly<Record<CppKind, string>> = {
  'cpp-app':          'apps',
  'cpp-lib':          'packages',
  'cpp-internal-lib': 'libs',
}

/**
 * A Node one-liner that finds the executable CMake built for a project.
 *
 * @remarks
 * Where it lands differs by generator: `<name>` or `<name>.exe` directly in the build directory for Makefiles and Ninja, in
 * a `Release/` folder for Visual Studio. The script looks for a regular file of either name anywhere under the build
 * directory, which is not a platform test.
 *
 * @param name - The project name, which is the output name of the executable.
 * @param buildDirectory - The build directory, workspace-relative.
 * @param then - JavaScript that runs with the path in `exe`.
 * @returns The `node -e` command.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
function withExecutable (name: string, buildDirectory: string, then: string): string {
  const script = [
    "const fs=require('node:fs');const p=require('node:path');",
    'const find=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?find(p.join(d,e.name)):[p.join(d,e.name)]);',
    `const exe=find('${buildDirectory}').find(f=>['${name}','${name}.exe'].includes(p.basename(f)));`,
    "if(!exe)throw new Error('no executable was built');",
    then,
  ].join('')

  return `node -e "${script}"`
}

/**
 * The targets of a C++ project, written explicitly because nothing infers them.
 *
 * @remarks
 * Each project configures into its own `dist/cmake/<name>`, so Nx's output clearing on a cache restore cannot delete another
 * project's artifacts. No generator is named: CMake picks the one the machine has (Visual Studio, Ninja or Makefiles), which
 * is why the configuration is passed with `--config` as well. `lint` is `cppcheck`, the compiler's `-Werror` being the first
 * linter and part of `build`. `typecheck` has no counterpart: compiling is the check.
 *
 * @param name - The project name.
 * @param directory - The project's workspace-relative directory.
 * @param app - Whether the project builds an executable.
 * @returns The Nx targets to merge into the project's `project.json`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function cppTargets (name: string, directory: string, app: boolean): Record<string, unknown> {
  const build = `dist/cmake/${name}`
  const debug = `dist/cmake/${name}-debug`
  const configure = (dir: string, type: string): string => `cmake -S ${directory} -B ${dir} -DCMAKE_BUILD_TYPE=${type}`
  const targets: Record<string, unknown> = {
    'build': {
      cache:    true,
      executor: 'nx:run-commands',
      inputs:   ['default'],
      outputs:  [`{workspaceRoot}/${build}`],
      options:  { commands: [configure(build, 'Release'), `cmake --build ${build} --config Release`], parallel: false },
    },
    'build-dev': {
      executor: 'nx:run-commands',
      outputs:  [`{workspaceRoot}/${debug}`],
      options:  { commands: [configure(debug, 'Debug'), `cmake --build ${debug} --config Debug`], parallel: false },
    },
    'test': {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      options:   { command: `ctest --test-dir ${build} -C Release --output-on-failure --no-tests=ignore` },
    },
    'lint': {
      cache:    true,
      executor: 'nx:run-commands',
      options:  {
        command: `cppcheck --error-exitcode=1 --enable=warning,style,performance,portability --inline-suppr --suppress=missingIncludeSystem -I ${directory}/src ${directory}`,
      },
    },
  }
  if (app) {
    targets.start = {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      options:   { command: withExecutable(name, build, "const r=require('node:child_process').spawnSync(exe,[],{stdio:'inherit'});process.exit(r.status??1)") },
    }
    targets.package = {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      outputs:   [`{workspaceRoot}/dist/drop/cpp-app-${name}.zip`],
      options:   {
        command: withExecutable(
          name,
          build,
          `fs.mkdirSync('dist/drop',{recursive:true});const A=require('adm-zip');const z=new A();z.addLocalFile(exe);z.writeZip('dist/drop/cpp-app-${name}.zip')`,
        ),
      },
    }
  }

  return targets
}

/**
 * Adds a C++ project: a CMake project with a worked example, explicit targets and, for a library, release by tag.
 *
 * @remarks
 * No Nx plugin is maintained for C++ (`nx-cmake` is pinned to Nx 18), and there is no generator to delegate to: CMake has no
 * `new` verb. mnci writes the `CMakeLists.txt` and the sources, as it writes a Bicep project. The package manager (a
 * project's own dependencies) is not wired yet, so a project depends on nothing but the standard library and the sibling
 * libraries it adds by hand with `add_subdirectory`.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param kind - Which C++ kind.
 * @param empty - Scaffold a bare project (`--empty`).
 * @returns Nothing.
 * @throws Error when a file cannot be written.
 * @typeParam None - this function has no generic type parameters.
 */
export function addCppProject (workspaceRoot: string, name: string, kind: CppKind, empty = false): void {
  const app = kind === 'cpp-app'
  const directory = `${CPP_DIRECTORIES[kind]}/${name}`
  const projectRoot = join(workspaceRoot, directory)
  if (app) {
    ensureAdmZip(workspaceRoot)
  }

  writeFileEnsured(join(projectRoot, 'CMakeLists.txt'), cppCmakeLists(kind, name, empty))
  const files = empty ? cppEmptyFiles(kind) : cppExampleFiles(kind, name)
  for (const [relative, contents] of Object.entries(files)) {
    writeFileEnsured(join(projectRoot, relative), contents)
  }
  writeFileEnsured(
    join(projectRoot, 'project.json'),
    `${JSON.stringify({
      name,
      $schema:     '../../node_modules/nx/schemas/project-schema.json',
      projectType: app ? 'application' : 'library',
      sourceRoot:  `${directory}/src`,
      tags:        [`type:${kind}`],
      targets:     {},
    }, undefined, 2)}\n`,
  )
  addProjectJsonTargets(join(projectRoot, 'project.json'), cppTargets(name, directory, app))
  if (kind === 'cpp-lib') {
    wireCppLibRelease(workspaceRoot, directory, name)
  }
  registerProjectCommands(workspaceRoot, name, app ? { build: true, start: `nx run ${name}:start`, buildDev: `nx run ${name}:build-dev` } : { build: kind === 'cpp-lib' })

  if (runCapture('cppcheck', ['--version'], workspaceRoot).status !== 0) {
    logger.warn('cppcheck is not on PATH, and it is what `lint` runs. Install it (apt install cppcheck, brew install cppcheck, choco install cppcheck).')
  }
  if (runCapture('cmake', ['--version'], workspaceRoot).status !== 0) {
    logger.warn('cmake is not on PATH, and `build` and `test` need it. Install CMake 3.20 or newer.')
  }
}
