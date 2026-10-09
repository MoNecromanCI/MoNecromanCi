/**
 * The Go counterpart of the vertical-slice file-role lint rule (#232).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { GO_SLICE_CHECK_PATH, GO_SLICE_CHECK_SCRIPT } from './go-slice-check.config'
export { goSliceCheckTarget } from './go-slice-check-target.algorithm'
