/**
 * The Rust and C++ counterpart of the vertical-slice file-role lint rule.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { SLICE_CHECK_PATH, SLICE_CHECK_SCRIPT } from './native-slice-check.config'
export { nativeSliceCheckTarget } from './native-slice-check-target.algorithm'
