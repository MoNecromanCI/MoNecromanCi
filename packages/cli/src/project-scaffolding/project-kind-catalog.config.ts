import type { ProjectKind } from './add-project.use-case'

/**
 * The language family a kind belongs to, which an editor groups its picker by.
 *
 * @remarks
 * The language families `add` offers; an editor groups its picker by them.
 * @typeParam None - this type has no generic type parameters.
 */
export type ProjectLanguage = 'typescript' | 'python' | 'go' | 'flutter' | 'csharp' | 'rust' | 'cpp' | 'java' | 'php' | 'ruby' | 'bicep' | 'container'

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
  { kind: 'react-app', language: 'typescript', label: 'React app', description: 'A Vite React app, built per environment', flags: ['e2e', 'empty'], requiredFlags: [] },
  { kind: 'html-app', language: 'typescript', label: 'HTML app', description: 'A web app of plain HTML, CSS and jQuery, built by Vite with Vitest, zipped for deployment', flags: ['empty'], requiredFlags: [] },
  { kind: 'react-p5-app', language: 'typescript', label: 'React p5 app', description: 'A Vite React app that draws with p5.js, built per environment', flags: ['e2e', 'empty'], requiredFlags: [] },
  { kind: 'angular-app', language: 'typescript', label: 'Angular app', description: 'An Angular app built with esbuild, zipped for deployment', flags: ['e2e', 'empty'], requiredFlags: [] },
  { kind: 'angular-internal-lib', language: 'typescript', label: 'Angular internal library', description: 'A private Angular library for apps in this workspace', flags: ['empty'], requiredFlags: [] },
  { kind: 'vue-app', language: 'typescript', label: 'Vue app', description: 'A Vite Vue app with Vitest, zipped for deployment', flags: ['empty'], requiredFlags: [] },
  { kind: 'svelte-app', language: 'typescript', label: 'Svelte app', description: 'A Vite Svelte app with Vitest, zipped for deployment', flags: ['empty'], requiredFlags: [] },
  { kind: 'react-lib', language: 'typescript', label: 'React library', description: 'A publishable React component library', flags: ['scope', 'empty'], requiredFlags: [] },
  { kind: 'react-internal-lib', language: 'typescript', label: 'React internal library', description: 'A private React library for apps in this workspace', flags: ['empty'], requiredFlags: [] },
  { kind: 'node-app', language: 'typescript', label: 'Node app', description: 'A Node service, with Express, Fastify, Koa or Nest if you choose one', flags: ['framework', 'esm', 'empty'], requiredFlags: [] },
  { kind: 'node-function-app', language: 'typescript', label: 'Node function app', description: 'An Azure Functions (v4) app in TypeScript', flags: ['empty', 'esm'], requiredFlags: [] },
  { kind: 'npm-lib', language: 'typescript', label: 'npm library', description: 'A library published to npm, bundled with Rollup', flags: ['scope', 'empty'], requiredFlags: [] },
  { kind: 'internal-lib', language: 'typescript', label: 'Internal library', description: 'A private TypeScript library for apps in this workspace', flags: ['empty'], requiredFlags: [] },
  { kind: 'bicep-iac', language: 'bicep', label: 'Bicep infrastructure', description: 'An Azure Bicep template linted and compiled with az bicep, zipped for deployment', flags: ['empty'], requiredFlags: [] },
  { kind: 'docs-site', language: 'typescript', label: 'Docs site', description: 'A Starlight (Astro) documentation site, zipped for deployment', flags: [], requiredFlags: [] },
  { kind: 'container', language: 'container', label: 'Container image', description: 'A Dockerfile and image targets for an existing Node, React or Go app', flags: ['app', 'port'], requiredFlags: ['app'] },
  { kind: 'vscode-extension', language: 'typescript', label: 'VS Code extension', description: 'A bundled Marketplace extension, optionally shipping a Go sidecar', flags: ['publisher', 'sidecar'], requiredFlags: [] },
  { kind: 'python-app', language: 'python', label: 'Python app', description: 'A pip-native Python application (Ruff, pytest)', flags: ['empty'], requiredFlags: [] },
  { kind: 'python-function-app', language: 'python', label: 'Python function app', description: 'An Azure Functions (v2 model) app in Python', flags: ['empty'], requiredFlags: [] },
  { kind: 'python-lib', language: 'python', label: 'Python library', description: 'A Python package published with twine', flags: ['empty'], requiredFlags: [] },
  { kind: 'python-internal-lib', language: 'python', label: 'Python internal library', description: 'A private Python library, vendored into the apps that use it', flags: ['empty'], requiredFlags: [] },
  { kind: 'python-vendor', language: 'python', label: 'Vendor a Python library', description: 'Copy an internal Python library into a consumer so it can be packaged', flags: ['lib', 'empty'], requiredFlags: ['lib'] },
  { kind: 'go-app', language: 'go', label: 'Go app', description: 'A Go executable with one static binary per platform', flags: ['release', 'cgo', 'web', 'empty'], requiredFlags: [] },
  { kind: 'go-function-app', language: 'go', label: 'Go function app', description: 'A Go Azure Functions custom handler', flags: ['empty'], requiredFlags: [] },
  { kind: 'go-lib', language: 'go', label: 'Go library', description: 'A Go module other repositories can go get', flags: ['empty'], requiredFlags: [] },
  { kind: 'go-internal-lib', language: 'go', label: 'Go internal library', description: 'A private Go module for apps in this workspace', flags: ['empty'], requiredFlags: [] },
  { kind: 'flutter-app', language: 'flutter', label: 'Flutter app', description: 'A Flutter app built for the web', flags: ['empty'], requiredFlags: [] },
  { kind: 'flutter-lib', language: 'flutter', label: 'Flutter library', description: 'A Dart package released by git tag', flags: ['empty'], requiredFlags: [] },
  { kind: 'flutter-internal-lib', language: 'flutter', label: 'Flutter internal library', description: 'A private Dart package for apps in this workspace', flags: ['empty'], requiredFlags: [] },
  { kind: 'csharp-app', language: 'csharp', label: 'C# app', description: 'A .NET console, web API or worker app', flags: ['empty'], requiredFlags: [] },
  { kind: 'csharp-function-app', language: 'csharp', label: 'C# function app', description: 'An Azure Functions isolated-worker app', flags: ['empty'], requiredFlags: [] },
  { kind: 'csharp-lib', language: 'csharp', label: 'C# library', description: 'A NuGet package', flags: ['scope', 'empty'], requiredFlags: [] },
  { kind: 'csharp-internal-lib', language: 'csharp', label: 'C# internal library', description: 'A private .NET library for apps in this workspace', flags: ['empty'], requiredFlags: [] },
  { kind: 'rust-app', language: 'rust', label: 'Rust app', description: 'A Rust executable, built with Cargo and zipped as a release binary', flags: ['empty'], requiredFlags: [] },
  { kind: 'rust-lib', language: 'rust', label: 'Rust library', description: 'A Rust crate other projects depend on', flags: ['empty'], requiredFlags: [] },
  { kind: 'rust-internal-lib', language: 'rust', label: 'Rust internal library', description: 'A private crate for apps in this workspace', flags: ['empty'], requiredFlags: [] },
  { kind: 'cpp-app', language: 'cpp', label: 'C++ app', description: 'A C++ executable built with CMake and zipped for deployment', flags: ['empty'], requiredFlags: [] },
  { kind: 'cpp-lib', language: 'cpp', label: 'C++ library', description: 'A C++ library released by git tag', flags: ['empty'], requiredFlags: [] },
  { kind: 'cpp-internal-lib', language: 'cpp', label: 'C++ internal library', description: 'A private C++ library for apps in this workspace', flags: ['empty'], requiredFlags: [] },
  { kind: 'java-app', language: 'java', label: 'Java app', description: 'A Java executable jar built with Maven and zipped for deployment', flags: ['empty'], requiredFlags: [] },
  { kind: 'java-lib', language: 'java', label: 'Java library', description: 'A Java library released by git tag', flags: ['empty'], requiredFlags: [] },
  { kind: 'java-internal-lib', language: 'java', label: 'Java internal library', description: 'A private Java library for apps in this workspace', flags: ['empty'], requiredFlags: [] },
  { kind: 'php-app', language: 'php', label: 'PHP app', description: 'A PHP application with a bin/ entry script, packaged as a zip; --template laravel scaffolds a Laravel app', flags: ['empty', 'template'], requiredFlags: [] },
  { kind: 'php-lib', language: 'php', label: 'PHP library', description: 'A Composer package released by git tag, which Packagist reads', flags: ['empty'], requiredFlags: [] },
  { kind: 'php-internal-lib', language: 'php', label: 'PHP internal library', description: 'A private Composer package for apps in this workspace', flags: ['empty'], requiredFlags: [] },
  { kind: 'ruby-app', language: 'ruby', label: 'Ruby app', description: 'A Ruby application on Bundler with a bin/ script, packaged as a zip', flags: ['empty'], requiredFlags: [] },
  { kind: 'ruby-lib', language: 'ruby', label: 'Ruby library', description: 'A Ruby gem released by git tag', flags: ['empty'], requiredFlags: [] },
  { kind: 'ruby-internal-lib', language: 'ruby', label: 'Ruby internal library', description: 'A private gem for apps in this workspace', flags: ['empty'], requiredFlags: [] },
]
