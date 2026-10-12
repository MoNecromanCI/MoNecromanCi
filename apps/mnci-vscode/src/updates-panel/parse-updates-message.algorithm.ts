/**
 * What the webview can ask the extension to do.
 *
 * @remarks
 * Either a request to update named packages or a request to look the updates up again; nothing else is accepted.
 * @typeParam None - this type has no generic type parameters.
 */
export type UpdatesMessage = { readonly type: 'update', readonly names: readonly string[] } | { readonly type: 'refresh' }

/** A package name as every ecosystem spells one: scope, path, `group:artifact`; never a flag, never whitespace. */
const PACKAGE_NAME = /^[a-z0-9@][\w.@/:+~-]*$/i

/**
 * Reads a message the webview posted.
 *
 * @remarks
 * A webview is a web page: whatever it posts is data to check, and the names end up in a command line run in a
 * terminal. A name is accepted only when it looks like a package name (no leading `-`, no whitespace or shell
 * characters) and, in the caller, only when the report listed it.
 *
 * @param message - What `onDidReceiveMessage` handed over.
 * @returns The request, or `undefined` for anything not understood.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function parseUpdatesMessage (message: unknown): UpdatesMessage | undefined {
  if (typeof message !== 'object' || message === null) {
    return undefined
  }
  const { type, names } = message as { type?: unknown, names?: unknown }
  if (type === 'refresh') {
    return { type: 'refresh' }
  }
  if (type !== 'update' || !Array.isArray(names)) {
    return undefined
  }
  const accepted = names.filter((name): name is string => typeof name === 'string' && PACKAGE_NAME.test(name))

  return accepted.length === names.length && accepted.length > 0 ? { type: 'update', names: [...new Set(accepted)] } : undefined
}
