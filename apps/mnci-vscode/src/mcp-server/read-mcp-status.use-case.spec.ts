import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMcpStatus } from './read-mcp-status.use-case'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnci-mcp-status-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('readMcpStatus', () => {
  it('is not registered in a workspace with neither file', () => {
    expect(readMcpStatus(root)).toBe('not-registered')
  })

  it('is registered by Claude Code\'s .mcp.json', () => {
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { mnci: { command: 'npx' } } }))

    expect(readMcpStatus(root)).toBe('registered')
  })

  it("is registered by VS Code's .vscode/mcp.json", () => {
    mkdirSync(join(root, '.vscode'))
    writeFileSync(join(root, '.vscode', 'mcp.json'), JSON.stringify({ servers: { mnci: { command: 'npx' } } }))

    expect(readMcpStatus(root)).toBe('registered')
  })

  it('is not registered when the file holds only other servers', () => {
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { other: {} } }))

    expect(readMcpStatus(root)).toBe('not-registered')
  })
})
