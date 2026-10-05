/**
 * Writes one value to stdout as indented JSON, and nothing else.
 *
 * @remarks
 * The `--json` flags exist for tools (an editor extension, a script) that parse stdout, so
 * the output must be exactly one JSON document: no banner, no colour, no trailing text. It
 * goes through `process.stdout` and not the logger, which prefixes its lines.
 *
 * @param value - Any JSON-serialisable value.
 * @returns Nothing.
 * @throws Error when the value cannot be serialised (a cycle, a BigInt).
 * @typeParam T - The value's type; unconstrained, it is only serialised.
 */
export function printJson<T> (value: T): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}
