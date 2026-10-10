/**
 * The `local.settings.json` an Azure Functions app needs for `func start` to know what the folder is.
 *
 * @remarks
 * Without `FUNCTIONS_WORKER_RUNTIME`, Core Tools 4.14 stops with "Worker runtime cannot be 'None'" for a Node, a Python,
 * a .NET and a custom-handler app alike (measured), so a `start` target that only ran `func start` never started. It holds no
 * secret, which is why a generated app commits it rather than ignoring it.
 *
 * @param runtime - The worker runtime the host should start: `node`, `python`, `dotnet-isolated` or `custom`.
 * @returns The file contents.
 * @throws Never - pure string construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function functionAppLocalSettings (runtime: 'node' | 'python' | 'dotnet-isolated' | 'custom'): string {
  return `${JSON.stringify({ IsEncrypted: false, Values: { FUNCTIONS_WORKER_RUNTIME: runtime } }, null, 2)}\n`
}
