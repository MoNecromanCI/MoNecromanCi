import type { UpdateDescription } from '../cli-contracts'
import { escapeHtml, isSafeLink, renderUpdatesPage } from './render-updates-page.algorithm'

function update (name: string, kind: UpdateDescription['kind'], overrides: Partial<UpdateDescription> = {}): UpdateDescription {
  return {
    name,
    ecosystem: 'npm',
    kind,
    current:   '1.0.0',
    latest:    '1.0.1',
    link:      `https://www.npmjs.com/package/${name}/v/1.0.1`,
    projects:  ['packages/a'],
    sections:  ['dep'],
    ...overrides,
  }
}

const base = { nonce: 'abc123', cspSource: 'vscode-resource:' }

describe('renderUpdatesPage', () => {
  it('groups by kind in report order and shows versions, projects and the release page', () => {
    const html = renderUpdatesPage({ ...base, updates: [update('ms', 'patch'), update('zod', 'minor'), update('chalk', 'major')] })

    expect(html.indexOf('Patch')).toBeLessThan(html.indexOf('Minor'))
    expect(html.indexOf('Minor')).toBeLessThan(html.indexOf('Major'))
    expect(html).toContain('<strong>1.0.1</strong>')
    expect(html).toContain('<span class="chip">packages/a</span>')
    expect(html).toContain('href="https://www.npmjs.com/package/zod/v/1.0.1"')
    expect(html).toContain('3 packages have a newer release')
  })

  it('has a policy that allows only the nonce, and no remote script', () => {
    const html = renderUpdatesPage({ ...base, updates: [update('ms', 'patch')] })

    expect(html).toContain("script-src 'nonce-abc123'")
    expect(html).toContain("default-src 'none'")
    expect(html).not.toMatch(/<script[^>]+src=/)
  })

  it('escapes what comes from a manifest', () => {
    const html = renderUpdatesPage({ ...base, updates: [update('<img src=x onerror=alert(1)>', 'patch', { projects: ['"><script>x</script>'] })] })

    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('"><script>x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('renders no link for anything but https', () => {
    const html = renderUpdatesPage({ ...base, updates: [update('a', 'patch', { link: 'javascript:alert(1)' }), update('b', 'patch', { link: undefined })] })

    expect(html).not.toContain('javascript:')
    expect(html.match(/no page/g)).toHaveLength(2)
  })

  it('says everything is current when there is nothing to update', () => {
    const html = renderUpdatesPage({ ...base, updates: [] })

    expect(html).toContain('Dependencies are up to date')
    expect(html).toContain('latest published release')
  })
})

describe('escapeHtml and isSafeLink', () => {
  it('replaces the five markup characters', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  })

  it('accepts an https address and refuses everything else', () => {
    expect(isSafeLink('https://pypi.org/project/ruff/0.9.0/')).toBe(true)
    expect(isSafeLink('ftp://example.com')).toBe(false)
    expect(isSafeLink('https://x" onclick="y')).toBe(false)
    expect(isSafeLink(undefined)).toBe(false)
  })
})
