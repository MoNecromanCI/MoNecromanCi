import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileExists, writeFileEnsured } from '../file-system'
import { withNodeTypes } from './react-app-example.algorithm'
import { registerProjectCommands, removeGeneratedEslintConfig } from './post-generation.use-case'

/**
 * Finishes the Playwright project an Nx app generator paired with an app.
 *
 * @remarks
 * Swaps Nx's sample test for one that checks what this app really renders, gives the project's tsconfig the Node types
 * its Playwright config reads (#410), makes sure no per-project ESLint config survives, and registers the commands. The
 * project is `<name>-e2e`; its `:qa` is lint and typecheck, because the inferred `e2e` target needs a browser
 * (`npx playwright install`), which CI's verify does not have. It has no `:build` or `:start`.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param name - The app's project name.
 * @param spec - The text of the end-to-end test, written to `src/greeting.e2e.spec.ts`.
 * @returns Nothing.
 * @throws Propagates any `fs` error.
 * @typeParam None - this function has no generic type parameters.
 */
export function finishPlaywrightProject (workspaceRoot: string, name: string, spec: string): void {
  const e2eName = `${name}-e2e`
  const e2eRoot = join(workspaceRoot, 'apps', e2eName)
  rmSync(join(e2eRoot, 'src/example.spec.ts'), { force: true })
  writeFileEnsured(join(e2eRoot, 'src/greeting.e2e.spec.ts'), spec)
  const tsconfigPath = join(e2eRoot, 'tsconfig.json')
  if (fileExists(tsconfigPath)) {
    writeFileEnsured(tsconfigPath, withNodeTypes(readFileSync(tsconfigPath, 'utf8')))
  }
  removeGeneratedEslintConfig(workspaceRoot, `apps/${e2eName}`)
  registerProjectCommands(workspaceRoot, e2eName, {
    build: false,
    qa:    `nx run ${e2eName}:lint && nx run ${e2eName}:typecheck`,
  })
}
