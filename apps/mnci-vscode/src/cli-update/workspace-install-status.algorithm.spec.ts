import { workspaceInstallStatus } from './workspace-install-status.algorithm'

describe('workspaceInstallStatus', () => {
  it('is current when the installed version is the newest', () => {
    expect(workspaceInstallStatus({ declared: '^4.101.0', installed: '4.101.0' }, '4.101.0')).toBe('current')
  })

  it('is outdated when installed is behind, however the declared range reads', () => {
    expect(workspaceInstallStatus({ declared: '^4.100.0', installed: '4.100.0' }, '4.101.0')).toBe('outdated')
    expect(workspaceInstallStatus({ declared: '^3.0.0', installed: '3.9.9' }, '4.0.0')).toBe('outdated')
    expect(workspaceInstallStatus({ declared: '^4.2.0', installed: '4.2.0' }, '4.10.0')).toBe('outdated')
  })

  it('is current, not outdated, when installed is ahead of what the registry reports', () => {
    expect(workspaceInstallStatus({ declared: '^5.0.0', installed: '5.0.0' }, '4.101.0')).toBe('current')
  })

  it('is missing when nothing is installed, even with a declared range', () => {
    expect(workspaceInstallStatus({ declared: '^4.101.0', installed: undefined }, '4.101.0')).toBe('missing')
  })

  it('is unknown when the registry did not answer or a version is not a triple', () => {
    expect(workspaceInstallStatus({ declared: undefined, installed: '4.101.0' }, null)).toBe('unknown')
    expect(workspaceInstallStatus({ declared: undefined, installed: 'next' }, '4.101.0')).toBe('unknown')
  })
})
