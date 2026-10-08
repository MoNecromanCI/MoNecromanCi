import type { CommandGroup } from './command-description.contract'

/**
 * The editor group of every command, by name.
 *
 * @remarks
 * Commander knows what a command is and how to call it; it has no notion of where an editor
 * should list it. This is the one place that says so. A command missing from here makes
 * `describeCommands` throw, so a new command cannot reach an editor ungrouped.
 */
export const COMMAND_GROUPS: Readonly<Record<string, CommandGroup>> = {
  new:      'workspace',
  upgrade:  'workspace',
  doctor:   'workspace',
  adopt:    'inspect',
  add:      'projects',
  dev:      'projects',
  install:  'dependencies',
  sync:     'dependencies',
  up:       'dependencies',
  ci:       'pipeline',
  commands: 'inspect',
  kinds:    'inspect',
  projects: 'inspect',
  info:     'inspect',
}
