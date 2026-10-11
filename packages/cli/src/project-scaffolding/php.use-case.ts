import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, writeFileEnsured } from '../file-system'
import { goModulePrefix } from '../go-workspace'
import { nativeSliceCheckTarget, SLICE_CHECK_PATH, SLICE_CHECK_SCRIPT } from '../native-slice-check'
import { runCapture } from '../nx-workspace'
import { logger } from '../terminal'
import { PHP_MIN_VERSION, PHP_TOOLS_BIN } from './php-build.config'
import {
  phpEmptyFiles,
  phpExampleFiles,
  type PhpKind,
  phpProjectComposerJson,
  phpRootComposerJson,
  phpStanConfig,
  phpUnitConfig,
  phpVendor,
} from './php-example.algorithm'
import { wirePhpLibRelease } from './php-release.use-case'
import { addProjectJsonTargets, ensureAdmZip, registerProjectCommands } from './post-generation.use-case'

/** Where each kind's project lives: apps under `apps/`, publishable libraries under `packages/`, private ones under `libs/`. */
const PHP_DIRECTORIES: Readonly<Record<PhpKind, string>> = {
  'php-app':          'apps',
  'php-lib':          'packages',
  'php-internal-lib': 'libs',
}

/** The Composer flags every non-interactive call shares. */
const COMPOSER = 'composer --no-interaction --no-progress'

/**
 * The command that runs one of the shared dev tools from the workspace root.
 *
 * @param tool - The executable's name under `vendor/bin`.
 * @returns The command, run through `php` so it works whatever the platform's script shim is.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function phpTool (tool: string): string {
  return `php ${PHP_TOOLS_BIN}/${tool}`
}

/**
 * The targets of a PHP project, written explicitly because nothing infers them.
 *
 * @remarks
 * The project installs its own runtime dependencies into its own `vendor/` (`build`, after `composer validate --strict`).
 * PHPUnit, PHPStan and PHP_CodeSniffer are installed once at the workspace root and run from there against the project, so
 * `test` and `lint` first make sure the root tools are installed (a no-op once they are). There is no `typecheck`: PHPStan is
 * part of `lint`, and PHP has no compile step.
 *
 * @param name - The project name.
 * @param directory - The project's workspace-relative directory.
 * @param app - Whether the project has an entry script.
 * @returns The Nx targets to merge into the project's `project.json`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function phpTargets (name: string, directory: string, app: boolean): Record<string, unknown> {
  const tools = `${COMPOSER} install`
  const sources = [`${directory}/src`, `${directory}/tests`, ...(app ? [`${directory}/bin`] : [])].join(' ')
  const targets: Record<string, unknown> = {
    'build': {
      cache:    true,
      executor: 'nx:run-commands',
      inputs:   ['default', '{projectRoot}/composer.lock'],
      outputs:  [`{workspaceRoot}/${directory}/vendor`],
      options:  {
        commands: [`${COMPOSER} validate --strict --working-dir=${directory}`, `${COMPOSER} install --working-dir=${directory}`],
        parallel: false,
      },
    },
    'test': {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      options:   {
        commands: [tools, `${phpTool('phpunit')} -c ${directory}/phpunit.xml.dist --do-not-fail-on-empty-test-suite`],
        parallel: false,
      },
    },
    'slice-check': nativeSliceCheckTarget('php', directory),
    'lint':        {
      executor:  'nx:run-commands',
      dependsOn: ['slice-check', 'build'],
      options:   {
        commands: [
          tools,
          `${phpTool('phpstan')} analyse -c ${directory}/phpstan.neon --no-progress`,
          `${phpTool('phpcs')} --standard=PSR12 ${sources}`,
        ],
        parallel: false,
      },
    },
  }
  if (app) {
    targets.start = {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      options:   { command: `php ${directory}/bin/${name}.php` },
    }
    targets.package = {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      outputs:   [`{workspaceRoot}/dist/drop/php-app-${name}.zip`],
      options:   {
        command: `node -e "const fs=require('node:fs');fs.mkdirSync('dist/drop',{recursive:true});const A=require('adm-zip');const z=new A();for(const d of ['src','bin','vendor'])z.addLocalFolder('${directory}/'+d,d);for(const f of ['composer.json','composer.lock'])if(fs.existsSync('${directory}/'+f))z.addLocalFile('${directory}/'+f);z.writeZip('dist/drop/php-app-${name}.zip')"`,
      },
    }
  }

  return targets
}

/**
 * Makes sure the workspace's `.gitignore` ignores Composer's `vendor/` folders.
 *
 * @remarks
 * `vendor/` is where Composer installs every dependency of a project and of the shared dev tools; nothing else ignores it.
 * One line with no leading slash covers the root and every project. Idempotent.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @returns Nothing.
 * @throws Error when `.gitignore` cannot be read or written.
 * @typeParam None - this function has no generic type parameters.
 */
function ensureVendorIgnored (workspaceRoot: string): void {
  const path = join(workspaceRoot, '.gitignore')
  const current = fileExists(path) ? readFileSync(path, 'utf8') : ''
  if (current.split('\n').some(line => ['vendor/', '/vendor/', 'vendor'].includes(line.trim()))) {
    return
  }
  const trimmed = current.replace(/\n+$/, '')
  writeFileEnsured(path, `${trimmed}${trimmed.length > 0 ? '\n\n' : ''}# Added by MoNecromanCI: Composer installs every PHP dependency into vendor/.\nvendor/\n`)
}

/**
 * Adds a PHP project: a Composer package with a worked example, explicit targets and, for a library, release by tag.
 *
 * @remarks
 * No maintained Nx plugin exists for PHP (`@nx-php/composer-plugin` was last published in 2023 and ships one executor), so
 * mnci writes the project as it writes a C++ or Java one. The workspace root gets a `composer.json` of shared dev tools
 * (PHPUnit, PHPStan, PHP_CodeSniffer) the first time; every project's runtime dependencies are its own.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param kind - Which PHP kind.
 * @param empty - Scaffold a bare project (`--empty`).
 * @returns Nothing.
 * @throws Error when a file cannot be written.
 * @typeParam None - this function has no generic type parameters.
 */
export function addPhpProject (workspaceRoot: string, name: string, kind: PhpKind, empty = false): void {
  const app = kind === 'php-app'
  const directory = `${PHP_DIRECTORIES[kind]}/${name}`
  const projectRoot = join(workspaceRoot, directory)
  const rootComposer = join(workspaceRoot, 'composer.json')
  const vendor = phpVendor(goModulePrefix(workspaceRoot))
  if (app) {
    ensureAdmZip(workspaceRoot)
  }
  if (!fileExists(rootComposer)) {
    writeFileEnsured(rootComposer, phpRootComposerJson(vendor))
  }

  writeFileEnsured(join(projectRoot, 'composer.json'), phpProjectComposerJson(kind, vendor, name))
  writeFileEnsured(join(projectRoot, 'phpunit.xml.dist'), phpUnitConfig(name))
  writeFileEnsured(join(projectRoot, 'phpstan.neon'), phpStanConfig(app))
  const files = empty ? phpEmptyFiles(kind, vendor, name) : phpExampleFiles(kind, vendor, name)
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
  writeFileEnsured(join(workspaceRoot, SLICE_CHECK_PATH), SLICE_CHECK_SCRIPT)
  addProjectJsonTargets(join(projectRoot, 'project.json'), phpTargets(name, directory, app))
  if (kind === 'php-lib') {
    wirePhpLibRelease(workspaceRoot, directory, name)
  }
  ensureVendorIgnored(workspaceRoot)
  registerProjectCommands(workspaceRoot, name, app ? { build: true, start: `nx run ${name}:start` } : { build: kind === 'php-lib' })

  for (const tool of ['php', 'composer']) {
    if (runCapture(tool, ['--version'], workspaceRoot).status !== 0) {
      logger.warn(`${tool} is not on PATH, and every PHP target runs it. Install PHP ${PHP_MIN_VERSION} or newer and Composer 2 (winget, apt, brew, shivammathur/setup-php).`)
    }
  }
}
