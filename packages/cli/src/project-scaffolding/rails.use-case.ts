import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, writeFileEnsured } from '../file-system'
import { runCapture, runShell } from '../nx-workspace'
import { logger } from '../terminal'
import { addProjectJsonTargets, ensureAdmZip, registerProjectCommands } from './post-generation.use-case'
import { addHelloRoute, railsExampleFiles, railsGitignore, railsTargets } from './rails-scaffold.algorithm'

/** The flags that leave out what mnci or the team's pipeline already owns: Rails' own CI, Docker, Kamal and Thruster files. */
const RAILS_NEW_FLAGS = ['--skip-git', '--skip-bundle', '--skip-ci', '--skip-docker', '--skip-kamal', '--skip-thruster']

/**
 * Runs a command, failing loudly with what was being done.
 *
 * @param command - The executable.
 * @param arguments_ - Its arguments.
 * @param cwd - Absolute path the command runs from.
 * @param doing - What the command is for, named in the error.
 * @returns Nothing.
 * @throws Error when the command is absent or exits non-zero.
 * @typeParam None - this function has no generic type parameters.
 */
function run (command: string, arguments_: string[], cwd: string, doing: string): void {
  const status = runShell(command, arguments_, cwd)
  if (status !== 0) {
    throw new Error(`${command} ${arguments_[0]} failed with exit code ${status} (${doing}). Rails needs Ruby 3.2 or newer with Bundler, and on Windows the MSYS2 toolchain RubyInstaller ships.`)
  }
}

/**
 * Adds a Rails application as a `ruby-app`: the framework's own skeleton, a worked example, explicit targets.
 *
 * @remarks
 * Scaffolded by `rails new`, the framework's own generator, so no template is hand-maintained against its releases (Rails
 * is installed with `gem install` first when it is absent). The app keeps its own `Gemfile`, `Gemfile.lock`, Minitest and omakase RuboCop
 * config. The framework mandates its folder names, so the Ruby `slice-check` is not wired: the worked example lives in
 * `app/features/greeting` and a controller calls it.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @returns Nothing.
 * @throws Error when the folder exists, or when `gem` or `rails` fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addRailsApp (workspaceRoot: string, name: string): void {
  const directory = `apps/${name}`
  const projectRoot = join(workspaceRoot, directory)
  if (fileExists(projectRoot)) {
    throw new Error(`${directory} already exists, and rails new needs an empty place.`)
  }
  ensureAdmZip(workspaceRoot)

  if (runCapture('rails', ['--version'], workspaceRoot).status !== 0) {
    logger.info('Rails is not installed; installing it with `gem install rails`.')
    run('gem', ['install', 'rails', '--no-document'], workspaceRoot, 'installing Rails')
  }
  run('rails', ['new', directory, ...RAILS_NEW_FLAGS], workspaceRoot, 'scaffolding the Rails skeleton')
  run('bundle', ['install'], projectRoot, 'installing the app\'s gems')

  for (const [relative, contents] of Object.entries(railsExampleFiles())) {
    writeFileEnsured(join(projectRoot, relative), contents)
  }
  const routes = join(projectRoot, 'config', 'routes.rb')
  writeFileEnsured(routes, addHelloRoute(readFileSync(routes, 'utf8')))
  writeFileEnsured(join(projectRoot, '.gitignore'), railsGitignore())
  writeFileEnsured(
    join(projectRoot, 'project.json'),
    `${JSON.stringify({
      name,
      $schema:     '../../node_modules/nx/schemas/project-schema.json',
      projectType: 'application',
      sourceRoot:  `${directory}/app`,
      tags:        ['type:ruby-app', 'framework:rails'],
      targets:     {},
    }, undefined, 2)}\n`,
  )
  addProjectJsonTargets(join(projectRoot, 'project.json'), railsTargets(name, directory))
  registerProjectCommands(workspaceRoot, name, { build: true, start: `nx run ${name}:start` })
  logger.info(`Rails app ${name} is in ${directory}. \`nx run ${name}:start\` serves it.`)
}
