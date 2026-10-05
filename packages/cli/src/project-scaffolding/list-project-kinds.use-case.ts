import { logger, printJson } from '../terminal'
import { PROJECT_KIND_CATALOG } from './project-kind-catalog.config'

/**
 * Flags of `mnci kinds`.
 *
 * @remarks
 * `mnci kinds` has only the one flag.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface KindsOptions {
  /** Print the kinds as one JSON document, for an editor or a script. */
  json?: boolean
}

/**
 * Prints every project kind `mnci add` accepts, with its language, a description and the
 * flags that apply to it.
 *
 * @remarks
 * `--json` is what an editor's "add project" picker is built from.
 *
 * @param options - The command's flags.
 * @returns Nothing.
 * @throws Never - prints a constant.
 * @typeParam None - this function has no generic type parameters.
 */
export function runKinds (options: KindsOptions): void {
  if (options.json === true) {
    printJson(PROJECT_KIND_CATALOG)

    return
  }
  for (const entry of PROJECT_KIND_CATALOG) {
    logger.info(`${entry.kind.padEnd(22)} ${entry.description}`)
  }
}
