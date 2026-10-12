import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, writeFileEnsured } from '../file-system'
import { runShell } from '../nx-workspace'
import { logger } from '../terminal'
import { PHP_MIN_VERSION } from './php-build.config'
import { addGreetRoute, forceTestEnvironment, holdsNoCode, laravelExampleFiles, laravelPhpStanConfig, laravelTargets } from './laravel-scaffold.algorithm'
import { addProjectJsonTargets, ensureAdmZip, registerProjectCommands } from './post-generation.use-case'

/** The Composer flags every non-interactive call shares. */
const COMPOSER_FLAGS = ['--no-interaction', '--no-progress']

/**
 * Runs Composer, failing loudly with what was being done.
 *
 * @param workspaceRoot - Absolute path the command runs from.
 * @param arguments_ - Composer's arguments (the shared non-interactive flags are added).
 * @param doing - What the command is for, named in the error.
 * @returns Nothing.
 * @throws Error when Composer is absent or exits non-zero.
 * @typeParam None - this function has no generic type parameters.
 */
function composer (workspaceRoot: string, arguments_: string[], doing: string): void {
  const status = runShell('composer', [...arguments_, ...COMPOSER_FLAGS], workspaceRoot)
  if (status !== 0) {
    throw new Error(`composer ${arguments_[0]} failed with exit code ${status} (${doing}). Laravel needs PHP ${PHP_MIN_VERSION} or newer with the openssl, mbstring, curl, zip, fileinfo and pdo_sqlite extensions, and Composer 2 on PATH.`)
  }
}

/**
 * Adds a Laravel application as a `php-app`: the framework's own skeleton, a worked example, explicit targets.
 *
 * @remarks
 * Scaffolded by `composer create-project laravel/laravel`, the framework's own installer, so no template is hand-maintained
 * against its releases. The app keeps its own `composer.json` and `vendor/`, and its own Pint and PHPUnit; Larastan is
 * installed beside them (Laravel's facades and Eloquent defeat plain PHPStan). The framework mandates its folder names, so
 * the PHP `slice-check` is not wired: the worked example lives in `app/Features/Greeting` and the route calls it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @returns Nothing.
 * @throws Error when the folder exists, or when Composer fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addLaravelApp (workspaceRoot: string, name: string): void {
  const directory = `apps/${name}`
  const projectRoot = join(workspaceRoot, directory)
  if (fileExists(projectRoot)) {
    throw new Error(`${directory} already exists, and composer create-project needs an empty place.`)
  }
  ensureAdmZip(workspaceRoot)

  composer(workspaceRoot, ['create-project', 'laravel/laravel', directory], 'scaffolding the Laravel skeleton')
  composer(projectRoot, ['require', '--dev', 'larastan/larastan'], 'installing Larastan')

  for (const [relative, contents] of Object.entries(laravelExampleFiles())) {
    writeFileEnsured(join(projectRoot, relative), contents)
  }
  const routes = join(projectRoot, 'routes', 'web.php')
  writeFileEnsured(routes, addGreetRoute(readFileSync(routes, 'utf8')))
  const phpunit = join(projectRoot, 'phpunit.xml')
  writeFileEnsured(phpunit, forceTestEnvironment(readFileSync(phpunit, 'utf8')))
  // The skeleton's entry point is an empty file, which the workspace lint rejects.
  const script = join(projectRoot, 'resources', 'js', 'app.js')
  if (fileExists(script) && holdsNoCode(readFileSync(script, 'utf8'))) {
    writeFileEnsured(script, ["// The app's JavaScript entry point, bundled by Vite.", 'export {}', ''].join('\n'))
  }
  writeFileEnsured(join(projectRoot, 'phpstan.neon'), laravelPhpStanConfig())
  writeFileEnsured(
    join(projectRoot, 'project.json'),
    `${JSON.stringify({
      name,
      $schema:     '../../node_modules/nx/schemas/project-schema.json',
      projectType: 'application',
      sourceRoot:  `${directory}/app`,
      tags:        ['type:php-app', 'framework:laravel'],
      targets:     {},
    }, undefined, 2)}\n`,
  )
  addProjectJsonTargets(join(projectRoot, 'project.json'), laravelTargets(name, directory))
  registerProjectCommands(workspaceRoot, name, { build: true, start: `nx run ${name}:start` })
  logger.info(`Laravel app ${name} is in ${directory}. \`nx run ${name}:start\` serves it; its own .env is not committed.`)
}
