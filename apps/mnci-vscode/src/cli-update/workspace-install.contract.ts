/**
 * What a workspace holds of `@mnci/cli`.
 *
 * @remarks
 * Read from the workspace's own `package.json` and `node_modules`, not from the CLI the extension runs: the two differ
 * whenever npx or a global install answers, and the workspace is what the team shares.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface WorkspaceInstall {
  /** The range `package.json` declares for `@mnci/cli`, or `undefined` when it declares none. */
  readonly declared:  string | undefined
  /** The version in `node_modules`, or `undefined` when it is not installed. */
  readonly installed: string | undefined
}

/**
 * How a workspace's `@mnci/cli` compares with the newest published one.
 *
 * @remarks
 * `unknown` is the registry not answering: neither a check nor a cross is honest then.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type WorkspaceInstallStatus = 'current' | 'outdated' | 'missing' | 'unknown'
