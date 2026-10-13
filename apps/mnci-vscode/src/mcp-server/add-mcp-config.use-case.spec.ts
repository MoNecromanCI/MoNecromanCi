import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addMcpConfig } from './add-mcp-config.use-case'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-mcp-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/**
 * Reads the server names `.mcp.json` declares.
 *
 * @returns The names, in file order.
 */
function serverNames (): string[] {
  const document = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8')) as { mcpServers: Record<string, unknown> }

  return Object.keys(document.mcpServers)
}

describe('addMcpConfig', () => {
  it('creates .mcp.json, then reports it as already there', () => {
    expect(addMcpConfig(root)).toBe('written')
    expect(serverNames()).toEqual(['mnci'])
    expect(addMcpConfig(root)).toBe('already-there')
  })

  it('adds beside another server', () => {
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'o' } } }))

    expect(addMcpConfig(root)).toBe('written')
    expect(serverNames()).toEqual(['other', 'mnci'])
  })

  it('leaves a broken file alone', () => {
    writeFileSync(join(root, '.mcp.json'), '{ nope')

    expect(addMcpConfig(root)).toBe('unreadable')
    expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe('{ nope')
  })
})
