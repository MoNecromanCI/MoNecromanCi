/**
 * One tool an AI can call through `mnci mcp`.
 *
 * @remarks
 * Every tool is one `mnci` command: `arguments_` turns the model's input into that command's argv, or throws a message the model can
 * act on. Nothing is ever put through a shell.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface McpTool {
  /** The name the client lists and calls. */
  name:        string
  /** What it does and when to use it, written for a model. */
  description: string
  /** The JSON Schema of its input. */
  inputSchema: Record<string, unknown>
  /** True when it only reads: a client may run it without asking. */
  readOnly:    boolean
  /** Turns the input into the `mnci` arguments. */
  arguments_:  (input: Record<string, unknown>) => string[]
}

/**
 * Reads a string that is a name and cannot be mistaken for an option.
 *
 * @param input - The tool's input.
 * @param key - The property to read.
 * @returns The value.
 * @throws Error when it is missing, empty, holds whitespace or starts with `-`.
 * @typeParam None - this function has no generic type parameters.
 */
function word (input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || value === '' || value.startsWith('-') || /\s/.test(value)) {
    throw new Error(`'${key}' must be a non-empty string with no spaces that does not start with '-'.`)
  }

  return value
}

const NO_INPUT = { type: 'object', properties: {}, additionalProperties: false } as const

/** The flags of `mnci add` a model may pass, and whether each takes a value or is a switch. */
const ADD_FLAGS: Readonly<Record<string, 'value' | 'switch'>> = {
  scope:     'value',
  framework: 'value',
  app:       'value',
  port:      'value',
  lib:       'value',
  publisher: 'value',
  sidecar:   'value',
  web:       'value',
  empty:     'switch',
  e2e:       'switch',
  esm:       'switch',
  release:   'switch',
  cgo:       'switch',
}

/**
 * The tools `mnci mcp` offers, in the order a client lists them.
 *
 * @remarks
 * The read-only ones are the JSON contract the editor extension reads (`commands`, `kinds`, `projects`, `info`, `doctor`). The
 * writing ones are the commands an assistant most often needs to change a workspace: add a project, install a dependency, bring the
 * versions into line, add a pipeline. `new`, `upgrade`, `adopt` and `up` are left to a person: each rewrites a great deal or asks
 * questions.
 */
export const MCP_TOOLS: readonly McpTool[] = [
  {
    name:        'mnci_commands',
    description: 'List every mnci command with its arguments and options. Use it first to see what mnci can do.',
    inputSchema: NO_INPUT,
    readOnly:    true,
    arguments_:  () => ['commands', '--json'],
  },
  {
    name:        'mnci_kinds',
    description: 'List the project kinds `mnci add` can create (language, description and the flags each accepts).',
    inputSchema: NO_INPUT,
    readOnly:    true,
    arguments_:  () => ['kinds', '--json'],
  },
  {
    name:        'mnci_projects',
    description: 'List the projects of this workspace: directory, ecosystem, kind and explicit targets.',
    inputSchema: NO_INPUT,
    readOnly:    true,
    arguments_:  () => ['projects', '--json'],
  },
  {
    name:        'mnci_info',
    description: 'Show the installed and newest published mnci version and the settings recorded for this workspace.',
    inputSchema: NO_INPUT,
    readOnly:    true,
    arguments_:  () => ['info', '--json'],
  },
  {
    name:        'mnci_doctor',
    description: 'Check the workspace against the invariants mnci maintains. Each finding names its remedy.',
    inputSchema: NO_INPUT,
    readOnly:    true,
    arguments_:  () => ['doctor', '--json'],
  },
  {
    name:        'mnci_add_project',
    description: 'Add a project of a kind (see mnci_kinds) to this workspace by delegating to the Nx generator. Writes files and installs packages.',
    inputSchema: {
      type:       'object',
      properties: {
        kind:      { type: 'string', description: 'The project kind, e.g. npm-lib, react-app, go-app.' },
        name:      { type: 'string', description: 'The project name.' },
        scope:     { type: 'string', description: 'npm scope for a publishable lib.' },
        framework: { type: 'string', enum: ['express', 'fastify', 'koa', 'nest', 'none'], description: 'node-app only.' },
        app:       { type: 'string', description: 'container only: the app to put in an image.' },
        port:      { type: 'string', description: 'container only: the port the app listens on.' },
        lib:       { type: 'string', description: 'python-vendor only: the internal library to vendor.' },
        publisher: { type: 'string', description: 'vscode-extension only: the Marketplace publisher id.' },
        sidecar:   { type: 'string', description: 'vscode-extension only: a go-app shipped inside it.' },
        web:       { type: 'string', description: 'go-app only: a react-app to embed.' },
        empty:     { type: 'boolean', description: 'A library kind: the slice skeleton only, no sample.' },
        e2e:       { type: 'boolean', description: 'react-app only: also add a Playwright project.' },
        esm:       { type: 'boolean', description: 'node-app, node-function-app: ES module output.' },
        release:   { type: 'boolean', description: 'go-app only: release it from its tag.' },
        cgo:       { type: 'boolean', description: 'go-app only: it needs a C toolchain.' },
      },
      required:             ['kind', 'name'],
      additionalProperties: false,
    },
    readOnly:   false,
    arguments_: (input) => {
      const flags: string[] = []
      for (const [key, shape] of Object.entries(ADD_FLAGS)) {
        if (shape === 'switch' && input[key] === true) {
          flags.push(`--${key}`)
        } else if (shape === 'value' && input[key] !== undefined) {
          flags.push(`--${key}`, word(input, key))
        }
      }

      return ['add', word(input, 'kind'), word(input, 'name'), ...flags]
    },
  },
  {
    name:        'mnci_install',
    description: "Add a dependency to one or more projects using each project's own toolchain (npm, pip, go, nuget, pub). A dependency always belongs to a project, never the workspace root.",
    inputSchema: {
      type:       'object',
      properties: {
        package:  { type: 'string', description: 'The package to add.' },
        projects: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'The projects to add it to, by directory (apps/foo) or name (foo).' },
        dev:      { type: 'boolean', description: 'A development dependency.' },
      },
      required:             ['package', 'projects'],
      additionalProperties: false,
    },
    readOnly:   false,
    arguments_: (input) => {
      const projects = input.projects
      if (!Array.isArray(projects) || projects.length === 0) {
        throw new Error("'projects' must list at least one project.")
      }
      const targets = projects.flatMap(project => ['-w', word({ project }, 'project')])

      return ['install', ...(input.dev === true ? ['-D'] : []), ...targets, word(input, 'package')]
    },
  },
  {
    name:        'mnci_sync',
    description: 'Make every dependency range declared at more than one version agree, then run nx sync. With check true it only reports drift.',
    inputSchema: {
      type:                 'object',
      properties:           { check: { type: 'boolean', description: 'Report drift without writing.' } },
      additionalProperties: false,
    },
    readOnly:   false,
    arguments_: input => ['sync', ...(input.check === true ? ['--check'] : [])],
  },
  {
    name:        'mnci_pipeline',
    description: 'Add a ready-made CI pipeline file (e2e, package-zip, deploy-pages, deploy-azure-function) to this workspace. Without a template it lists them.',
    inputSchema: {
      type:       'object',
      properties: {
        template: { type: 'string', description: 'The template name; leave out to list them.' },
        project:  { type: 'string', description: 'The app a deploy template works on.' },
        ci:       { type: 'string', enum: ['azure', 'github', 'both'] },
      },
      additionalProperties: false,
    },
    readOnly:   false,
    arguments_: (input) => {
      const optional = (key: string): string | undefined => (input[key] === undefined ? undefined : word(input, key))
      const template = optional('template')
      const project = optional('project')
      const ci = optional('ci')

      return ['pipeline', ...(template === undefined ? [] : [template]), ...(project === undefined ? [] : ['--project', project]), ...(ci === undefined ? [] : ['--ci', ci])]
    },
  },
]
