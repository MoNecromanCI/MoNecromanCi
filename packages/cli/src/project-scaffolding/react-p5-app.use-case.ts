import { runShell } from '../nx-workspace'
import { writeFileEnsured } from '../file-system'
import { join } from 'node:path'
import { addReactApp } from './react-app.use-case'
import { reactP5AppExampleFiles } from './react-p5-app-example.algorithm'
import { type WorkspaceStack } from './post-generation.use-case'

/**
 * The runtime packages a p5 app needs, installed into the app's own manifest and never the root.
 *
 * @remarks
 * `p5` 2 ships its own types, so there is no `@types/p5` (that package describes 1.x). The wrapper's peers are
 * `p5 >= 2`, `react >= 19` and `react-dom >= 19`, which the React generator already satisfies.
 */
export const P5_DEPENDENCIES = ['p5', '@p5-wrapper/react'] as const

/**
 * Adds a React app that draws with p5.js: the `react-app` kind plus p5 and its React wrapper, with a worked example.
 *
 * @remarks
 * Everything React is `addReactApp`'s: the generator, per-environment builds, slices, `--e2e` and `--empty`.
 * What this adds is the two packages, installed into the app's own manifest, and a `bouncing-ball` slice written over
 * the greeting-only example (the pure motion as an algorithm, the p5 adapter as a client, the wrapper as a component).
 * A bare app (`--empty`) still gets the packages, since they are the point of the kind, and no sketch.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The project name (already validated).
 * @param stack - The workspace's chosen linter/test runner.
 * @param e2e - Pair a Playwright project, as for `react-app`.
 * @param empty - Scaffold a bare app: an empty `main` and no sketch.
 * @returns Nothing.
 * @throws Error when the React generator or the install fails.
 * @typeParam None - this function has no generic type parameters.
 */
export function addReactP5App (workspaceRoot: string, name: string, stack: WorkspaceStack, e2e = false, empty = false): void {
  addReactApp(workspaceRoot, name, stack, e2e, empty)
  // A plain install first, so npm knows the app's workspace: the first `-w apps/<name>` after the folder appears is
  // otherwise a no-op that exits 0 (measured on npm 12, see svelte-app).
  if (runShell('npm', ['install'], workspaceRoot) !== 0) {
    throw new Error('npm install failed after scaffolding the React app')
  }
  if (runShell('npm', ['install', '-w', `apps/${name}`, ...P5_DEPENDENCIES], workspaceRoot) !== 0) {
    throw new Error(`npm install of ${P5_DEPENDENCIES.join(', ')} into ${name} failed`)
  }
  if (empty) {
    return
  }
  const appRoot = join(workspaceRoot, 'apps', name)
  const example = reactP5AppExampleFiles(name)
  for (const [relative, contents] of Object.entries(example)) {
    writeFileEnsured(join(appRoot, 'src', relative), contents)
  }
}
