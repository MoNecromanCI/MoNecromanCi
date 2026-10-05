/**
 * Reads a name from whatever VS Code passed a command.
 *
 * @remarks
 * A tree row's click passes the strings it was built with; a context-menu entry passes the row
 * itself. A row is read by its `label`, which is the project's name.
 *
 * @param value - A string, a tree row with a `label`, or anything else.
 * @returns The name, or `undefined` when the value holds none.
 * @throws Never - pure inspection.
 * @typeParam None - this function has no generic type parameters.
 */
export function nameFrom (value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'object' && value !== null && 'label' in value && typeof value.label === 'string') {
    return value.label
  }

  return undefined
}
