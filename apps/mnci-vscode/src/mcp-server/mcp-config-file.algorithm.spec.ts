import { namesMnciServer, withMnciMcpServer } from './mcp-config-file.algorithm'

describe('withMnciMcpServer', () => {
  it('writes the file the CLI writes when there is none', () => {
    const result = withMnciMcpServer(undefined)

    expect(result.changed).toBe(true)
    expect(JSON.parse(result.text)).toEqual({ mcpServers: { mnci: { command: 'npx', args: ['mnci', 'mcp'] } } })
  })

  it("keeps the team's other servers and other keys", () => {
    const result = withMnciMcpServer(JSON.stringify({ note: 'x', mcpServers: { other: { command: 'o' } } }))

    expect(result.changed).toBe(true)
    expect(JSON.parse(result.text)).toEqual({
      note:       'x',
      mcpServers: { other: { command: 'o' }, mnci: { command: 'npx', args: ['mnci', 'mcp'] } },
    })
  })

  it('leaves a file that already names mnci exactly as it is', () => {
    const text = '{ "mcpServers": { "mnci": { "command": "mnci", "args": ["mcp"] } } }'

    expect(withMnciMcpServer(text)).toEqual({ text, changed: false })
  })

  it('never overwrites a file that is not a JSON object', () => {
    expect(withMnciMcpServer('{ nope')).toMatchObject({ text: '{ nope', changed: false, problem: expect.any(String) })
    expect(withMnciMcpServer('[1]')).toMatchObject({ changed: false, problem: expect.any(String) })
  })
})

describe('namesMnciServer', () => {
  it('finds the server under mcpServers (Claude Code) and servers (VS Code)', () => {
    expect(namesMnciServer('{ "mcpServers": { "mnci": {} } }')).toBe(true)
    expect(namesMnciServer('{ "servers": { "mnci": {} } }')).toBe(true)
  })

  it('does not find another server, or text that is not JSON', () => {
    expect(namesMnciServer('{ "mcpServers": { "other": {} } }')).toBe(false)
    expect(namesMnciServer('{ nope')).toBe(false)
    expect(namesMnciServer('null')).toBe(false)
  })
})
