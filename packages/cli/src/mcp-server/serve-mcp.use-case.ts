import { createInterface } from 'node:readline'
import spawn from 'cross-spawn'
import { handleMcpMessage, type McpToolResult } from './handle-mcp-message.use-case'
import { MCP_TOOLS } from './mcp-tool-catalog.config'

/** How long one `mnci` command a tool runs may take, in milliseconds: `add` installs packages. */
const COMMAND_TIMEOUT_MS = 15 * 60_000

/**
 * Runs this same CLI with the given arguments in a workspace and captures what it printed.
 *
 * @remarks
 * The CLI's own entry file is run by the current Node, so no shell is involved and an argument is never reinterpreted. Standard
 * input is closed, so a command that would ask a question fails instead of waiting for a person who is not there.
 *
 * @param workspaceRoot - Where the command runs.
 * @param entry - The CLI's entry file.
 * @param arguments_ - The `mnci` arguments.
 * @returns The output and whether the command failed.
 * @throws Never - a command that does not start is a failed result.
 * @typeParam None - this function has no generic type parameters.
 */
async function runMnci (workspaceRoot: string, entry: string, arguments_: string[]): Promise<McpToolResult> {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [entry, ...arguments_], {
      cwd:   workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env:   { ...process.env, NO_COLOR: '1' },
    })
    const chunks: Buffer[] = []
    // A command that prints one JSON document (--json) has that document on stdout, and the model must get it whole: a note on
    // stderr (an update is available) would sit in the middle of it.
    const json = arguments_.includes('--json')
    const timer = setTimeout(() => { child.kill() }, COMMAND_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (!json) {
        chunks.push(chunk)
      }
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ text: `Could not start mnci: ${error.message}`, isError: true })
    })
    child.on('close', (status) => {
      clearTimeout(timer)
      resolve({ text: Buffer.concat(chunks).toString('utf8').trim(), isError: status !== 0 })
    })
  })
}

/**
 * Serves the Model Context Protocol on standard input and output until the client closes it (`mnci mcp`).
 *
 * @remarks
 * One JSON message per line, as the stdio transport has it. Nothing but protocol may reach standard output, so the server logs
 * nothing there, and a line that is not JSON is answered with a parse error rather than dropped. Messages are answered in the
 * order they arrive.
 *
 * @param workspaceRoot - The workspace the tools act on.
 * @param entry - The CLI's entry file, run for every tool call.
 * @param version - The CLI's version.
 * @returns Resolves when the input closes.
 * @throws Never - a failing tool is a result the model reads.
 * @typeParam None - this function has no generic type parameters.
 */
export async function serveMcp (workspaceRoot: string, entry: string, version: string): Promise<void> {
  const context = { tools: MCP_TOOLS, version, run: async (arguments_: string[]) => await runMnci(workspaceRoot, entry, arguments_) }
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of lines) {
    if (line.trim() === '') {
      continue
    }
    let response
    try {
      response = await handleMcpMessage(JSON.parse(line), context)
    } catch {
      response = { jsonrpc: '2.0' as const, id: null, error: { code: -32700, message: 'Parse error' } }
    }
    if (response !== undefined) {
      process.stdout.write(`${JSON.stringify(response)}\n`)
    }
  }
}
