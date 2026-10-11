import { join } from 'node:path'
import { fileExists, writeFileEnsured } from '../file-system'
import { nativeSliceCheckTarget, SLICE_CHECK_PATH, SLICE_CHECK_SCRIPT } from '../native-slice-check'
import { runCapture } from '../nx-workspace'
import { logger } from '../terminal'
import { RUBOCOP_CONFIG } from './ruby-build.config'
import {
  rubyEmptyFiles,
  rubyExampleFiles,
  rubyGemspec,
  type RubyKind,
  rubyProjectGemfile,
  rubyRootGemfile,
} from './ruby-example.algorithm'
import { wireRubyLibRelease } from './ruby-release.use-case'
import { addProjectJsonTargets, ensureAdmZip, registerProjectCommands } from './post-generation.use-case'

/** Where each kind's project lives: apps under `apps/`, publishable libraries under `packages/`, private ones under `libs/`. */
const RUBY_DIRECTORIES: Readonly<Record<RubyKind, string>> = {
  'ruby-app':          'apps',
  'ruby-lib':          'packages',
  'ruby-internal-lib': 'libs',
}

/**
 * The targets of a Ruby project, written explicitly because nothing infers them.
 *
 * @remarks
 * Bundler runs in the project's directory (`cwd`), so it reads that project's `Gemfile` and `Gemfile.lock` and nothing
 * else: dependencies are per project. RuboCop is the one shared tool, run from the workspace root, whose `Gemfile` lists
 * only it. A library's `build` also builds the gem into `dist/gems`. There is no `typecheck`: Ruby has no compile step
 * (RuboCop is part of `lint`).
 *
 * @param name - The project name.
 * @param directory - The project's workspace-relative directory.
 * @param kind - Which Ruby kind.
 * @returns The Nx targets to merge into the project's `project.json`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function rubyTargets (name: string, directory: string, kind: RubyKind): Record<string, unknown> {
  const app = kind === 'ruby-app'
  const targets: Record<string, unknown> = {
    'build': {
      cache:    true,
      executor: 'nx:run-commands',
      inputs:   ['default', '{projectRoot}/Gemfile.lock'],
      outputs:  app ? [] : [`{workspaceRoot}/dist/gems/${name}.gem`],
      options:  {
        cwd:      directory,
        commands: ['bundle install', ...(app ? [] : [`gem build ${name}.gemspec --output ../../dist/gems/${name}.gem`])],
        parallel: false,
      },
    },
    'test': {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      options:   { cwd: directory, command: 'bundle exec rspec' },
    },
    'slice-check': nativeSliceCheckTarget('ruby', directory),
    'lint':        {
      executor:  'nx:run-commands',
      dependsOn: ['slice-check'],
      options:   {
        commands: ['bundle install', `bundle exec rubocop --config .rubocop.yml ${directory}`],
        parallel: false,
      },
    },
  }
  if (app) {
    targets.start = {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      options:   { cwd: directory, command: `bundle exec ruby bin/${name}` },
    }
    targets.package = {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      outputs:   [`{workspaceRoot}/dist/drop/ruby-app-${name}.zip`],
      options:   {
        command: `node -e "const fs=require('node:fs');fs.mkdirSync('dist/drop',{recursive:true});const A=require('adm-zip');const z=new A();for(const d of ['lib','bin'])z.addLocalFolder('${directory}/'+d,d);for(const f of ['Gemfile','Gemfile.lock'])if(fs.existsSync('${directory}/'+f))z.addLocalFile('${directory}/'+f);z.writeZip('dist/drop/ruby-app-${name}.zip')"`,
      },
    }
  }

  return targets
}

/**
 * Adds a Ruby project: a Bundler project (an app) or a gem (a library) with a worked example and explicit targets.
 *
 * @remarks
 * No Nx plugin exists for Ruby (`nx-ruby` and its scoped variants are all absent from npm), so mnci writes the project as
 * it writes a PHP or Java one. The workspace root gets a `Gemfile` of RuboCop and a `.rubocop.yml` the first time;
 * every project's gems, RSpec included, are its own.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param kind - Which Ruby kind.
 * @param empty - Scaffold a bare project (`--empty`).
 * @returns Nothing.
 * @throws Error when a file cannot be written.
 * @typeParam None - this function has no generic type parameters.
 */
export function addRubyProject (workspaceRoot: string, name: string, kind: RubyKind, empty = false): void {
  const app = kind === 'ruby-app'
  const directory = `${RUBY_DIRECTORIES[kind]}/${name}`
  const projectRoot = join(workspaceRoot, directory)
  if (app) {
    ensureAdmZip(workspaceRoot)
  }
  if (!fileExists(join(workspaceRoot, 'Gemfile'))) {
    writeFileEnsured(join(workspaceRoot, 'Gemfile'), rubyRootGemfile())
  }
  if (!fileExists(join(workspaceRoot, '.rubocop.yml'))) {
    writeFileEnsured(join(workspaceRoot, '.rubocop.yml'), RUBOCOP_CONFIG)
  }

  writeFileEnsured(join(projectRoot, 'Gemfile'), rubyProjectGemfile(kind))
  if (!app) {
    writeFileEnsured(join(projectRoot, `${name}.gemspec`), rubyGemspec(name))
  }
  const files = empty ? rubyEmptyFiles(kind, name) : rubyExampleFiles(kind, name)
  for (const [relative, contents] of Object.entries(files)) {
    writeFileEnsured(join(projectRoot, relative), contents)
  }
  writeFileEnsured(
    join(projectRoot, 'project.json'),
    `${JSON.stringify({
      name,
      $schema:     '../../node_modules/nx/schemas/project-schema.json',
      projectType: app ? 'application' : 'library',
      sourceRoot:  `${directory}/lib`,
      tags:        [`type:${kind}`],
      targets:     {},
    }, undefined, 2)}\n`,
  )
  writeFileEnsured(join(workspaceRoot, SLICE_CHECK_PATH), SLICE_CHECK_SCRIPT)
  addProjectJsonTargets(join(projectRoot, 'project.json'), rubyTargets(name, directory, kind))
  if (kind === 'ruby-lib') {
    wireRubyLibRelease(workspaceRoot, directory, name)
  }
  registerProjectCommands(workspaceRoot, name, app ? { build: true, start: `nx run ${name}:start` } : { build: kind === 'ruby-lib' })

  for (const tool of ['ruby', 'bundle']) {
    if (runCapture(tool, ['--version'], workspaceRoot).status !== 0) {
      logger.warn(`${tool} is not on PATH, and every Ruby target runs it. Install Ruby 3.3 or newer (RubyInstaller on Windows, ruby-build, apt, brew); Bundler ships with it.`)
    }
  }
}
