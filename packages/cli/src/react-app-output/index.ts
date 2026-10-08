/**
 * Keeping `tsc` and Vite from writing into the same folder in a React app (#346).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { findReactAppsSharingOutput } from './find-react-apps-sharing-output.use-case'
export { separateReactAppOutput, separateReactAppsOutput } from './separate-react-app-output.use-case'
