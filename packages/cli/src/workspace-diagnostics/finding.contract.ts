/**
 * One check's outcome.
 *
 * @remarks
 * `remedy` is separate from `detail` on purpose: the detail says what is wrong in
 * this workspace, the remedy says what to type. A finding without a remedy is a
 * finding the user cannot act on, which is the main way a doctor command becomes
 * noise.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface Finding {
  /** Short check name, shown as the line label. */
  check:    string
  /** Whether the invariant holds. */
  ok:       boolean
  /** What is wrong, when it is not ok. */
  detail?:  string
  /** The command or edit that fixes it. */
  remedy?:  string
  /** A passing finding the user should still read: reported as a warning, never failing the run. */
  warning?: boolean
}
