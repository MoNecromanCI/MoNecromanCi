import { mcpServerLaunch } from './mcp-server-definition.algorithm'

describe('mcpServerLaunch', () => {
  it('starts the located CLI with mcp, in the workspace root', () => {
    expect(mcpServerLaunch({ command: 'npx', prefix: ['--yes', '@mnci/cli@latest'], source: 'npx' }, '/ws')).toEqual({
      label:   'MNCI',
      command: 'npx',
      args:    ['--yes', '@mnci/cli@latest', 'mcp'],
      cwd:     '/ws',
    })
  })

  it('uses the workspace install as it is, with no prefix', () => {
    expect(mcpServerLaunch({ command: '/ws/node_modules/.bin/mnci', prefix: [], source: 'workspace' }, '/ws')?.args).toEqual(['mcp'])
  })

  it('has nothing to start without an open folder', () => {
    expect(mcpServerLaunch({ command: 'mnci', prefix: [], source: 'path' }, undefined)).toBeUndefined()
  })
})
