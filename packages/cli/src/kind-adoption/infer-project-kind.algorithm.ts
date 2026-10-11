import type { Ecosystem } from '../dependency-management'

/**
 * What the inference reads about one project, gathered so the rules stay a pure function.
 *
 * @remarks
 * `manifest` is the parsed `package.json` for an npm project and empty for the others, whose manifests are
 * not JSON; `text` is the main manifest's text (`pyproject.toml`, `pubspec.yaml`, the `.csproj`).
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ProjectEvidence {
  /** The toolchain that owns the project's manifest. */
  ecosystem:  Ecosystem
  /** The parsed `package.json`, for an npm project. */
  manifest:   Record<string, unknown>
  /** The text of the project's main manifest. */
  text:       string
  /** The names in the project's own directory. */
  files:      readonly string[]
  /** Whether a Go `package main` or a Dart `lib/main.dart` was found: a program, not a library. */
  hasProgram: boolean
}

/**
 * How sure the inference is.
 *
 * @remarks
 * A `guess` is never applied without being named by a flag.
 * @typeParam None - this type has no generic type parameters.
 */
export type KindCertainty = 'certain' | 'guess'

/**
 * The kind proposed for a project, and why.
 *
 * @remarks
 * `reason` is shown to the person, so a guess says what decided it.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface KindProposal {
  /** The `mnci add` kind. */
  kind:      string
  /** Whether it can be applied without being asked. */
  certainty: KindCertainty
  /** What decided it. */
  reason:    string
}

const SERVER_FRAMEWORKS: readonly string[] = ['express', 'koa', 'fastify', '@nestjs/core']

/**
 * Whether a manifest declares a dependency, in any of the three places.
 *
 * @param manifest - A parsed `package.json`.
 * @param name - The dependency name.
 * @returns True when it is in `dependencies`, `devDependencies` or `peerDependencies`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function declares (manifest: Record<string, unknown>, name: string): boolean {
  return ['dependencies', 'devDependencies', 'peerDependencies'].some(key => {
    const block = manifest[key]

    return typeof block === 'object' && block !== null && Object.keys(block).includes(name)
  })
}

/**
 * Proposes the kind of an npm project.
 *
 * @param evidence - What was read about it.
 * @returns The proposal.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function inferNpm (evidence: ProjectEvidence): KindProposal {
  const { manifest, files } = evidence
  const engines = manifest.engines as Record<string, unknown> | undefined
  if (engines?.vscode !== undefined) {
    return { kind: 'vscode-extension', certainty: 'certain', reason: 'engines.vscode is set' }
  }
  if (files.includes('host.json') || declares(manifest, '@azure/functions')) {
    return { kind: 'node-function-app', certainty: 'certain', reason: 'an Azure Functions host.json or @azure/functions' }
  }
  const privatePackage = manifest.private === true
  if (declares(manifest, '@angular/core') && files.includes('index.html')) {
    return { kind: 'angular-app', certainty: 'certain', reason: 'Angular with an index.html entry' }
  }
  if (declares(manifest, 'svelte') && files.includes('index.html')) {
    return { kind: 'svelte-app', certainty: 'certain', reason: 'Svelte with an index.html entry' }
  }
  if (declares(manifest, 'vue') && files.includes('index.html')) {
    return { kind: 'vue-app', certainty: 'certain', reason: 'Vue with an index.html entry' }
  }
  if (declares(manifest, 'react') || declares(manifest, 'react-dom')) {
    if (files.includes('index.html')) {
      return { kind: 'react-app', certainty: 'certain', reason: 'React with an index.html entry' }
    }

    return { kind: privatePackage ? 'react-internal-lib' : 'react-lib', certainty: 'certain', reason: `React without an index.html, ${privatePackage ? 'private' : 'publishable'}` }
  }
  const framework = SERVER_FRAMEWORKS.find(name => declares(manifest, name))
  if (framework !== undefined) {
    return { kind: 'node-app', certainty: 'certain', reason: `a ${framework} server` }
  }
  const scripts = manifest.scripts as Record<string, unknown> | undefined
  if (manifest.bin !== undefined || scripts?.start !== undefined) {
    return { kind: 'node-app', certainty: 'guess', reason: 'it has a bin or a start script, but no known server framework' }
  }
  if (privatePackage) {
    return { kind: 'internal-lib', certainty: 'certain', reason: 'private, with no entry point of its own' }
  }
  const hasEntry = ['main', 'module', 'exports'].some(key => manifest[key] !== undefined)

  return { kind: 'npm-lib', certainty: hasEntry ? 'certain' : 'guess', reason: hasEntry ? 'publishable, with a library entry' : 'publishable, but no main, module or exports' }
}

/**
 * Proposes the kind of a Python project.
 *
 * @param evidence - What was read about it.
 * @returns The proposal.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function inferPython (evidence: ProjectEvidence): KindProposal {
  const { files, text } = evidence
  if (files.includes('function_app.py') || files.includes('host.json')) {
    return { kind: 'python-function-app', certainty: 'certain', reason: 'an Azure Functions function_app.py or host.json' }
  }
  if (text.includes('[project.scripts]') || files.includes('__main__.py')) {
    return { kind: 'python-app', certainty: 'guess', reason: 'it declares a script or a __main__.py, which a library can too' }
  }
  if (text.includes('Private :: Do Not Upload')) {
    return { kind: 'python-internal-lib', certainty: 'certain', reason: 'classified Private :: Do Not Upload' }
  }

  return { kind: 'python-lib', certainty: 'guess', reason: 'a library, but internal or published is a choice only you can make' }
}

/**
 * Proposes the kind of a Dart or Flutter project.
 *
 * @param evidence - What was read about it.
 * @returns The proposal.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function inferFlutter (evidence: ProjectEvidence): KindProposal {
  if (evidence.hasProgram) {
    return { kind: 'flutter-app', certainty: 'certain', reason: 'lib/main.dart is the entry point' }
  }
  const internal = /^publish_to:\s*['"]?none['"]?\s*$/m.test(evidence.text)

  return { kind: internal ? 'flutter-internal-lib' : 'flutter-lib', certainty: 'certain', reason: internal ? 'publish_to: none' : 'publishable, with no entry point' }
}

/**
 * Proposes the kind of a .NET project.
 *
 * @param evidence - What was read about it.
 * @returns The proposal.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function inferCsharp (evidence: ProjectEvidence): KindProposal {
  const { text } = evidence
  if (/<OutputType>\s*Exe\s*<\/OutputType>/i.test(text)) {
    const functions = /Microsoft\.Azure\.Functions|Azure\.Functions\.Sdk/.test(text)

    return { kind: functions ? 'csharp-function-app' : 'csharp-app', certainty: 'certain', reason: functions ? 'an executable using the Azure Functions worker' : 'an executable' }
  }
  if (/<IsPackable>\s*false\s*<\/IsPackable>/i.test(text)) {
    return { kind: 'csharp-internal-lib', certainty: 'certain', reason: 'IsPackable is false' }
  }

  return { kind: 'csharp-lib', certainty: 'guess', reason: 'a library, but internal or published is a choice only you can make' }
}

/**
 * Proposes the kind of a Go module.
 *
 * @param evidence - What was read about it.
 * @returns The proposal.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function inferGo (evidence: ProjectEvidence): KindProposal {
  if (evidence.hasProgram) {
    const functions = evidence.files.includes('host.json')

    return { kind: functions ? 'go-function-app' : 'go-app', certainty: 'certain', reason: functions ? 'package main with an Azure Functions host.json' : 'a package main' }
  }

  return { kind: 'go-lib', certainty: 'guess', reason: 'a library, but internal or published is a choice only you can make' }
}

/**
 * Proposes the mnci kind of an existing project from what its manifest and directory show.
 *
 * @remarks
 * Certain only where the evidence names the kind outright: an `index.html` next to React, an
 * `OutputType` of `Exe`, a `package main`. Where two kinds fit (a library that is internal or
 * published, a script that is an app or a library) it says `guess` and why, so the caller asks
 * rather than picks.
 *
 * @param evidence - What was read about the project.
 * @returns The proposed kind, how sure it is and why.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function inferProjectKind (evidence: ProjectEvidence): KindProposal {
  switch (evidence.ecosystem) {
    case 'npm': {
      return inferNpm(evidence)
    }
    case 'pip': {
      return inferPython(evidence)
    }
    case 'pub': {
      return inferFlutter(evidence)
    }
    case 'nuget': {
      return inferCsharp(evidence)
    }
    case 'go': {
      return inferGo(evidence)
    }
  }
}
