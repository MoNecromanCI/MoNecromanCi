import type { ProjectKind } from './add-project.use-case'

/**
 * The language family a kind belongs to, which an editor groups its picker by.
 *
 * @remarks
 * The language families `add` offers; an editor groups its picker by them.
 * @typeParam None - this type has no generic type parameters.
 */
export type ProjectLanguage = 'typescript' | 'python' | 'go' | 'flutter' | 'csharp' | 'container'

/**
 * One project kind, described for a picker: what it makes, in which language, and which `add` flags apply.
 *
 * @remarks
 * One entry per kind, in `PROJECT_KIND_CATALOG`.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ProjectKindDescription {
  readonly kind:          ProjectKind
  readonly language:      ProjectLanguage
  readonly label:         string
  readonly description:   string
  /** Names of the `add` options that apply to this kind (`framework`, `empty`, …). */
  readonly flags:         readonly string[]
  /** The flags, among `flags`, that the kind cannot be added without. */
  readonly requiredFlags: readonly string[]
}

/**
 * Every project kind `mnci add` accepts, described for tools.
 *
 * @remarks
 * Commander lists the kind names as the argument's choices but carries nothing about them,
 * so this is where a kind is explained. Its test fails when a kind has no entry, when an
 * entry names a kind that does not exist, or when a flag is not one `add` declares.
 */
export const PROJECT_KIND_CATALOG: readonly ProjectKindDescription[] = [
  { kind: 'react-app', language: 'typescript', label: 'React app', description: 'A Vite React app, built per environment', flags: ['e2e'], requiredFlags: [] },
  { kind: 'react-lib', language: 'typescript', label: 'React library', description: 'A publishable React component library', flags: ['scope', 'empty'], requiredFlags: [] },
  { kind: 'react-internal-lib', language: 'typescript', label: 'React internal library', description: 'A private React library for apps in this workspace', flags: ['empty'], requiredFlags: [] },
  { kind: 'node-app', language: 'typescript', label: 'Node app', description: 'A Node service, with Express, Fastify, Koa or Nest if you choose one', flags: ['framework', 'esm'], requiredFlags: [] },
  { kind: 'node-function-app', language: 'typescript', label: 'Node function app', description: 'An Azure Functions (v4) app in TypeScript', flags: ['empty', 'esm'], requiredFlags: [] },
  { kind: 'npm-lib', language: 'typescript', label: 'npm library', description: 'A library published to npm, bundled with Rollup', flags: ['scope', 'empty'], requiredFlags: [] },
  { kind: 'internal-lib', language: 'typescript', label: 'Internal library', description: 'A private TypeScript library for apps in this workspace', flags: ['empty'], requiredFlags: [] },
  { kind: 'container', language: 'container', label: 'Container image', description: 'A Dockerfile and image targets for an existing Node, React or Go app', flags: ['app', 'port'], requiredFlags: ['app'] },
  { kind: 'vscode-extension', language: 'typescript', label: 'VS Code extension', description: 'A bundled Marketplace extension, optionally shipping a Go sidecar', flags: ['publisher', 'sidecar'], requiredFlags: [] },
  { kind: 'python-app', language: 'python', label: 'Python app', description: 'A pip-native Python application (Ruff, pytest)', flags: [], requiredFlags: [] },
  { kind: 'python-function-app', language: 'python', label: 'Python function app', description: 'An Azure Functions (v2 model) app in Python', flags: [], requiredFlags: [] },
  { kind: 'python-lib', language: 'python', label: 'Python library', description: 'A Python package published with twine', flags: [], requiredFlags: [] },
  { kind: 'python-internal-lib', language: 'python', label: 'Python internal library', description: 'A private Python library, vendored into the apps that use it', flags: [], requiredFlags: [] },
  { kind: 'python-vendor', language: 'python', label: 'Vendor a Python library', description: 'Copy an internal Python library into a consumer so it can be packaged', flags: ['lib'], requiredFlags: ['lib'] },
  { kind: 'go-app', language: 'go', label: 'Go app', description: 'A Go executable with one static binary per platform', flags: ['release', 'cgo', 'web'], requiredFlags: [] },
  { kind: 'go-function-app', language: 'go', label: 'Go function app', description: 'A Go Azure Functions custom handler', flags: [], requiredFlags: [] },
  { kind: 'go-lib', language: 'go', label: 'Go library', description: 'A Go module other repositories can go get', flags: [], requiredFlags: [] },
  { kind: 'go-internal-lib', language: 'go', label: 'Go internal library', description: 'A private Go module for apps in this workspace', flags: [], requiredFlags: [] },
  { kind: 'flutter-app', language: 'flutter', label: 'Flutter app', description: 'A Flutter app built for the web', flags: [], requiredFlags: [] },
  { kind: 'flutter-lib', language: 'flutter', label: 'Flutter library', description: 'A Dart package released by git tag', flags: [], requiredFlags: [] },
  { kind: 'flutter-internal-lib', language: 'flutter', label: 'Flutter internal library', description: 'A private Dart package for apps in this workspace', flags: [], requiredFlags: [] },
  { kind: 'csharp-app', language: 'csharp', label: 'C# app', description: 'A .NET console, web API or worker app', flags: [], requiredFlags: [] },
  { kind: 'csharp-function-app', language: 'csharp', label: 'C# function app', description: 'An Azure Functions isolated-worker app', flags: [], requiredFlags: [] },
  { kind: 'csharp-lib', language: 'csharp', label: 'C# library', description: 'A NuGet package', flags: ['scope'], requiredFlags: [] },
  { kind: 'csharp-internal-lib', language: 'csharp', label: 'C# internal library', description: 'A private .NET library for apps in this workspace', flags: [], requiredFlags: [] },
]
