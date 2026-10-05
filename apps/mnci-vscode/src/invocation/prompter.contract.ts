/**
 * One choice in a pick list.
 *
 * @remarks
 * `value` is what the flow receives; `label`, `description` and `detail` are what the user reads.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface PickItem {
  readonly label:        string
  readonly value:        string
  readonly description?: string
  readonly detail?:      string
}

/**
 * A pick-list entry: a choice, or a heading that groups the choices after it.
 *
 * @remarks
 * Headings are never returned as an answer.
 * @typeParam None - this type has no generic type parameters.
 */
export type PickEntry = PickItem | { readonly separator: string }

/**
 * How a flow asks the user things.
 *
 * @remarks
 * Every method resolves to `undefined` when the user cancels (Escape), which a flow treats as
 * "stop, change nothing". `pickMany` resolves to an empty list when the user confirms with
 * nothing chosen, which is an answer: "none of these".
 * @typeParam None - this interface has no generic type parameters.
 */
export interface Prompter {
  pickOne:    (entries: readonly PickEntry[], placeholder: string) => Promise<string | undefined>
  pickMany:   (entries: readonly PickItem[], placeholder: string) => Promise<string[] | undefined>
  /** Free text. An empty answer is `''` unless `required`, in which case the box refuses it. */
  askText:    (prompt: string, options?: { readonly required?: boolean, readonly placeholder?: string }) => Promise<string | undefined>
  pickFolder: (title: string) => Promise<string | undefined>
}
