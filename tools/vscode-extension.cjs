#!/usr/bin/env node
// Written by mnci: 'mnci add vscode-extension' creates it and 'mnci upgrade'
// rewrites it, so local edits do not survive an upgrade.
//
// Packages and publishes a VS Code extension project. Its Nx targets call it:
//   node tools/vscode-extension.cjs package apps/<name> [--sidecar <go-app>]
//   node tools/vscode-extension.cjs publish apps/<name> [--sidecar <go-app>]
// Without --sidecar: one universal dist/drop/<project>.vsix.
// With --sidecar: one dist/drop/<project>-<target>.vsix per Marketplace target, each
// carrying that platform's binary from the Go app's build-all in bin/.
'use strict'
const { spawnSync } = require('node:child_process')
const { cpSync, existsSync, mkdirSync, readFileSync, rmSync } = require('node:fs')
const { basename, dirname, join, resolve } = require('node:path')

const TARGETS = { 'win32-x64': 'windows-amd64', 'win32-arm64': 'windows-arm64', 'linux-x64': 'linux-amd64', 'linux-arm64': 'linux-arm64', 'alpine-x64': 'linux-amd64', 'alpine-arm64': 'linux-arm64', 'darwin-x64': 'darwin-amd64', 'darwin-arm64': 'darwin-arm64' }
const DROP = resolve('dist/drop')
const VSCE_FLAGS = ['--no-dependencies', '--skip-license', '--allow-missing-repository']

function fail (message) {
  console.error(message)
  process.exit(1)
}

function bin (packageName, command) {
  const manifestPath = require.resolve(packageName + '/package.json', { paths: [process.cwd()] })
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[command]

  return join(dirname(manifestPath), entry)
}

function run (packageName, command, args, options) {
  const result = spawnSync(process.execPath, [bin(packageName, command), ...args], { stdio: 'inherit', ...options })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function vsixFiles (name, sidecar) {
  return sidecar
    ? Object.keys(TARGETS).map(target => join(DROP, name + '-' + target + '.vsix'))
    : [join(DROP, name + '.vsix')]
}

function packageExtension (projectRoot, manifest, sidecar) {
  mkdirSync(DROP, { recursive: true })
  if (!sidecar) {
    run('@vscode/vsce', 'vsce', ['package', ...VSCE_FLAGS, '--out', vsixFiles(project)[0]], { cwd: projectRoot })

    return
  }
  run('nx', 'nx', ['run', sidecar + ':build-all'], { env: { ...process.env, VERSION: manifest.version } })
  const staging = join(projectRoot, 'bin')
  try {
    for (const [target, platform] of Object.entries(TARGETS)) {
      const source = join('dist/platforms', sidecar, platform)
      if (!existsSync(source)) fail('No ' + platform + ' build of ' + sidecar + ' at ' + source + ' - its build-all target did not write one.')
      rmSync(staging, { recursive: true, force: true })
      cpSync(source, staging, { recursive: true })
      run('@vscode/vsce', 'vsce', ['package', '--target', target, ...VSCE_FLAGS, '--out', join(DROP, project + '-' + target + '.vsix')], { cwd: projectRoot })
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

function publishExtension (manifest, sidecar, dryRun) {
  if (dryRun) {
    console.log('Dry run - would publish ' + vsixFiles(project, sidecar).join(', ') + ' to the Marketplace.')

    return
  }
  const entra = process.env.VSCE_AUTH === 'entra'
  const token = process.env.VSCE_PAT ?? ''
  if (!entra && (token === '' || /^\$\(.*\)$/.test(token))) {
    console.log('No Marketplace credential - skipping the Marketplace publish of ' + manifest.name + '. Set the AZURE_CLIENT_ID and AZURE_TENANT_ID variables (Microsoft Entra ID) or the VSCE_PAT secret to publish.')

    return
  }
  const files = vsixFiles(project, sidecar)
  const missing = files.filter(file => !existsSync(file))
  if (missing.length > 0) fail('Nothing to publish: ' + missing.join(', ') + ' not found - run the package target first.')
  run('@vscode/vsce', 'vsce', ['publish', ...(entra ? ['--azure-credential'] : []), '--packagePath', ...files, '--skip-duplicate'])
}

const [command, projectRoot, ...rest] = process.argv.slice(2)
const sidecarIndex = rest.indexOf('--sidecar')
const sidecar = sidecarIndex === -1 ? undefined : rest[sidecarIndex + 1]
if (!projectRoot || !existsSync(join(projectRoot, 'package.json'))) fail('Usage: node tools/vscode-extension.cjs package|publish <project root> [--sidecar <go-app>]')
const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
// Packages are named after the project folder, never the manifest name, which is
// free to change (the Marketplace id need not match the folder).
const project = basename(resolve(projectRoot))
// nx release --dry-run hands the publish target --dryRun=true and sets NX_DRY_RUN
// (measured on Nx 23), so a dry run never reaches the Marketplace, token or not.
const dryRun = rest.some(argument => /^--dry-?run(?:=true)?$/i.test(argument)) || process.env.NX_DRY_RUN === 'true'
if (command === 'package') packageExtension(projectRoot, manifest, sidecar)
else if (command === 'publish') publishExtension(manifest, sidecar, dryRun)
else fail('Unknown command ' + command + ' - expected package or publish.')
