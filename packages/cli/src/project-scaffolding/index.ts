/**
 * Adds one project of a given kind, and applies the post-generation repairs every kind needs.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only
 * through this barrel, never by a path into the files below.
 */

export * from './add-project.use-case'
export * from './list-project-kinds.use-case'
export * from './post-generation.use-case'
export * from './project-kind-catalog.config'
export { addGoPlatformTargets, addGoSliceChecks, GO_PLATFORMS } from './go.use-case'
export { addPythonDevTargets } from './python.use-case'
export { addCsharpDevTargets } from './csharp.use-case'
export { GO_RELEASE_SCRIPT_PATH, refreshGoReleaseScript } from './go-release.use-case'
export {
  pinVscodeExtensionProjectNames,
  refreshVscodeExtensionScript,
  VSCODE_EXTENSION_SCRIPT_PATH,
} from './vscode-extension.use-case'
export { refreshContainerScript } from './container.use-case'
