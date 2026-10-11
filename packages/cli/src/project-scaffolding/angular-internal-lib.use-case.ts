import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { runNx } from '../nx-workspace'
import { fileExists, toJson, writeFileEnsured } from '../file-system'
import { angularLibEmptyFiles, angularLibExampleFiles } from './angular-app-example.algorithm'
import {
  ANGULAR_APP_COMPILER_OPTIONS,
  angularTypecheckTarget,
  moveTestSetupOutOfSrc,
  overrideCompilerOptions,
  withUnsupportedTsSetupAllowed,
} from './angular-app.use-case'
import {
  addProjectJsonTargets,
  defaultScope,
  ensurePlugin,
  registerProjectCommands,
  removeGeneratedEslintConfig,
  type WorkspaceStack,
} from './post-generation.use-case'

/**
 * Adds an Angular internal library: `@nx/angular:library`, private, consumed by the workspace's apps.
 *
 * @remarks
 * The same generator override as {@link addAngularApp} applies, and a library needs its own repairs: the generator's `src/lib/<name>/` is a technology bucket the slice rules forbid,
 * so a `greeting` feature behind the barrel replaces it, and a private manifest is written, which is where `@angular/*`
 * lands when a library is the first Angular project (a runtime dependency at the root fails `mnci doctor`).
 *
 * The library is not buildable: an app imports it through the `tsconfig` path the generator writes, which the Angular
 * builders honour. A publishable Angular library (ng-packagr) is not covered.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param stack - The workspace's chosen linter/test runner.
 * @param empty - Scaffold a bare library: a barrel with nothing exported (`--empty`).
 * @returns Nothing.
 * @throws Error when the generator or a required install fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addAngularInternalLib (workspaceRoot: string, name: string, stack: WorkspaceStack, empty = false): void {
  withUnsupportedTsSetupAllowed(() => {
    ensurePlugin(workspaceRoot, '@nx/angular')
    runNx(
      [
        'g',
        '@nx/angular:library',
        `libs/${name}`,
        `--name=${name}`,
        `--importPath=${defaultScope(workspaceRoot)}/${name}`,
        `--unitTestRunner=${stack.testRunner === 'vitest' ? 'vitest-angular' : 'jest'}`,
        '--linter=none',
        '--style=css',
        '--no-interactive',
      ],
      workspaceRoot,
    )
  })
  const root = join(workspaceRoot, 'libs', name)
  const manifestPath = join(root, 'package.json')
  if (!fileExists(manifestPath)) {
    writeFileEnsured(manifestPath, toJson({ name: `${defaultScope(workspaceRoot)}/${name}`, version: '0.0.0', private: true }))
  }
  // Unlike an app, the library's own configuration stays `composite` with declaration output: an app that imports it
  // references it, and a reference to a project that is not composite fails (TS6306). Its specs are checked on their own,
  // so they leave the references behind.
  overrideCompilerOptions(join(root, 'tsconfig.json'), { lib: ANGULAR_APP_COMPILER_OPTIONS.lib })
  overrideCompilerOptions(join(root, 'tsconfig.spec.json'), {
    ...ANGULAR_APP_COMPILER_OPTIONS,
    module:           'preserve',
    moduleResolution: 'bundler',
    rootDir:          '../..',
  })
  overrideCompilerOptions(join(root, 'tsconfig.lib.json'), { inlineSources: false })

  // `lib/` is a technology bucket, and the generator's placeholder component is a demo.
  rmSync(join(root, 'src/lib'), { recursive: true, force: true })
  rmSync(join(root, 'src/index.ts'), { force: true })
  moveTestSetupOutOfSrc(root)
  const example = empty ? angularLibEmptyFiles() : angularLibExampleFiles()
  for (const [relative, contents] of Object.entries(example)) {
    writeFileEnsured(join(root, 'src', relative), contents)
  }

  addProjectJsonTargets(join(root, 'project.json'), { typecheck: angularTypecheckTarget(`libs/${name}`, 'tsconfig.lib.json') })
  removeGeneratedEslintConfig(workspaceRoot, `libs/${name}`)
  registerProjectCommands(workspaceRoot, name, { build: false })
}
