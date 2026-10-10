import { inferProjectKind, type ProjectEvidence } from './infer-project-kind.algorithm'

/** Evidence with sensible empty defaults. */
function evidence (change: Partial<ProjectEvidence>): ProjectEvidence {
  return { ecosystem: 'npm', manifest: {}, text: '', files: [], hasProgram: false, ...change }
}

describe('inferProjectKind (npm)', () => {
  it.each([
    ['a VS Code extension', { engines: { vscode: '^1.90.0' } }, [], 'vscode-extension', 'certain'],
    ['an Azure Functions app', { dependencies: { '@azure/functions': '^4' } }, [], 'node-function-app', 'certain'],
    ['a React app', { dependencies: { react: '^19' } }, ['index.html'], 'react-app', 'certain'],
    ['an Angular app', { dependencies: { '@angular/core': '^22' } }, ['index.html'], 'angular-app', 'certain'],
    ['a publishable React library', { peerDependencies: { react: '^19' } }, [], 'react-lib', 'certain'],
    ['a private React library', { private: true, peerDependencies: { react: '^19' } }, [], 'react-internal-lib', 'certain'],
    ['an express server', { dependencies: { express: '^4' } }, [], 'node-app', 'certain'],
    ['a private library', { private: true }, [], 'internal-lib', 'certain'],
    ['a publishable library with an entry', { main: './dist/index.js' }, [], 'npm-lib', 'certain'],
  ])('reads %s', (_label, manifest, files, kind, certainty) => {
    expect(inferProjectKind(evidence({ manifest, files }))).toMatchObject({ kind, certainty })
  })

  it('only guesses when a bin or start script is the whole evidence of an app', () => {
    expect(inferProjectKind(evidence({ manifest: { scripts: { start: 'node .' } } }))).toMatchObject({ kind: 'node-app', certainty: 'guess' })
  })

  it('only guesses a publishable library with no entry point', () => {
    expect(inferProjectKind(evidence({ manifest: { name: 'x' } }))).toMatchObject({ kind: 'npm-lib', certainty: 'guess' })
  })
})

describe('inferProjectKind (the other ecosystems)', () => {
  it('reads a Python function app and guesses at the rest', () => {
    expect(inferProjectKind(evidence({ ecosystem: 'pip', files: ['function_app.py'] }))).toMatchObject({ kind: 'python-function-app', certainty: 'certain' })
    expect(inferProjectKind(evidence({ ecosystem: 'pip', text: '[project.scripts]\nx = "y:z"' }))).toMatchObject({ kind: 'python-app', certainty: 'guess' })
    expect(inferProjectKind(evidence({ ecosystem: 'pip', text: '[project]' }))).toMatchObject({ kind: 'python-lib', certainty: 'guess' })
    expect(inferProjectKind(evidence({ ecosystem: 'pip', text: 'Private :: Do Not Upload' }))).toMatchObject({ kind: 'python-internal-lib', certainty: 'certain' })
  })

  it('reads Flutter by its entry point and publish_to', () => {
    expect(inferProjectKind(evidence({ ecosystem: 'pub', hasProgram: true }))).toMatchObject({ kind: 'flutter-app' })
    expect(inferProjectKind(evidence({ ecosystem: 'pub', text: 'name: x\npublish_to: none\n' }))).toMatchObject({ kind: 'flutter-internal-lib' })
    expect(inferProjectKind(evidence({ ecosystem: 'pub', text: 'name: x\n' }))).toMatchObject({ kind: 'flutter-lib' })
  })

  it('reads C# by OutputType, the Functions worker and IsPackable', () => {
    expect(inferProjectKind(evidence({ ecosystem: 'nuget', text: '<OutputType>Exe</OutputType>' }))).toMatchObject({ kind: 'csharp-app' })
    expect(inferProjectKind(evidence({ ecosystem: 'nuget', text: '<OutputType>Exe</OutputType><PackageReference Include="Microsoft.Azure.Functions.Worker"/>' }))).toMatchObject({ kind: 'csharp-function-app' })
    expect(inferProjectKind(evidence({ ecosystem: 'nuget', text: '<IsPackable>false</IsPackable>' }))).toMatchObject({ kind: 'csharp-internal-lib' })
    expect(inferProjectKind(evidence({ ecosystem: 'nuget', text: '<Project/>' }))).toMatchObject({ kind: 'csharp-lib', certainty: 'guess' })
  })

  it('reads Go by whether it has a package main', () => {
    expect(inferProjectKind(evidence({ ecosystem: 'go', hasProgram: true }))).toMatchObject({ kind: 'go-app', certainty: 'certain' })
    expect(inferProjectKind(evidence({ ecosystem: 'go', hasProgram: true, files: ['host.json'] }))).toMatchObject({ kind: 'go-function-app' })
    expect(inferProjectKind(evidence({ ecosystem: 'go' }))).toMatchObject({ kind: 'go-lib', certainty: 'guess' })
  })
})
