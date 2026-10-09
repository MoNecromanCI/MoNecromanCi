/**
 * Releasing a Go library by tag: `<directory>/vX.Y.Z`, versioned from conventional commits (#359).
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export { listGoLibraryDirectories, releaseGoLibraries } from './release-go-libraries.use-case'
