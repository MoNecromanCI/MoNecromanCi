import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as vscode from 'vscode'
import type { CommandDescription } from './cli-contracts'
import { CLI_COMMAND_NAMES, commandId, EXTENSION_ONLY_COMMAND_NAMES } from './commands'
import { activate } from './main'

const ROOT = join(__dirname, '..')

interface Manifest {
  contributes: {
    commands:        Array<{ command: string, title: string }>
    views:           Record<string, Array<{ id: string }>>
    viewsWelcome:    Array<{ view: string, contents: string }>
    menus:           Record<string, Array<{ command: string }>>
    configuration:   { properties: Record<string, unknown> }
    viewsContainers: { activitybar: Array<{ icon: string }> }
  }
  activationEvents: string[]
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Manifest
const cliCommands = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/cli-commands.json'), 'utf8')) as CommandDescription[]
const declared = manifest.contributes.commands.map(entry => entry.command)

/** A list in alphabetical order, for comparing sets. */
function alphabetical (list: readonly string[]): string[] {
  return list.toSorted((a, b) => a.localeCompare(b))
}

describe('the extension manifest', () => {
  it('offers every CLI command that is not machine-only, as the snapshot of `mnci commands --json` lists them', () => {
    const offered = cliCommands.filter(command => command.group !== 'inspect').map(command => command.name)

    expect(alphabetical(offered)).toEqual(alphabetical(CLI_COMMAND_NAMES))
  })

  it('declares a titled command for every command the code registers, and no other', () => {
    const expected = [...CLI_COMMAND_NAMES, ...EXTENSION_ONLY_COMMAND_NAMES].map(name => commandId(name))

    expect(alphabetical(declared)).toEqual(alphabetical(expected))
    for (const entry of manifest.contributes.commands) {
      expect(entry.title.length).toBeGreaterThan(3)
    }
  })

  it('registers each declared command when activated, so none is a palette entry that does nothing', async () => {
    activate({ subscriptions: [] } as unknown as vscode.ExtensionContext)

    const registered = await vscode.commands.getCommands()
    for (const id of declared) {
      expect(registered).toContain(id)
    }
  })

  it('refers, in menus and welcome text, only to commands it declares', () => {
    const referenced = [
      ...Object.values(manifest.contributes.menus).flat().map(item => item.command),
      ...manifest.contributes.viewsWelcome.flatMap(entry => entry.contents.matchAll(/command:([\w.]+)/g).map(match => match[1]).toArray()),
    ]

    for (const id of referenced) {
      expect(declared).toContain(id)
    }
  })

  it('declares the three views the sidebar serves, under its container', () => {
    expect(manifest.contributes.views.mnci.map(view => view.id)).toEqual(['mnci.commands', 'mnci.projects', 'mnci.update'])
  })

  it('ships the side bar icon it points at', () => {
    for (const container of manifest.contributes.viewsContainers.activitybar) {
      expect(existsSync(join(ROOT, container.icon))).toBe(true)
    }
  })

  it('declares the one setting the extension reads, and activates for a workspace', () => {
    expect(Object.keys(manifest.contributes.configuration.properties)).toEqual(['mnci.cliPath'])
    expect(manifest.activationEvents).toContain('workspaceContains:nx.json')
  })
})
