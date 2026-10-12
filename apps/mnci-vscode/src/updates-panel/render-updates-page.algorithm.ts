import type { UpdateDescription, UpdateKind } from '../cli-contracts'

/**
 * What a page needs to render: the answer, and the two values the webview's security policy is built from.
 *
 * @remarks
 * The nonce must be fresh for every page; reusing one would let a stale script run.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface UpdatesPageInput {
  /** The updates `mnci up --json` found. */
  readonly updates:   readonly UpdateDescription[]
  /** A fresh random token; the inline script and style are allowed by it and by nothing else. */
  readonly nonce:     string
  /** The webview's `cspSource`. */
  readonly cspSource: string
}

const SECTIONS: ReadonlyArray<{ kind: UpdateKind, title: string, blurb: string }> = [
  { kind: 'patch', title: 'Patch', blurb: 'Backwards-compatible bug fixes.' },
  { kind: 'minor', title: 'Minor', blurb: 'New backwards-compatible features.' },
  { kind: 'major', title: 'Major', blurb: 'Breaking changes: read the release notes before updating.' },
  { kind: 'non-semver', title: 'Other', blurb: 'Versions that do not follow semver; compare them yourself.' },
]

const HTML_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }

/**
 * Escapes text for an HTML element or a quoted attribute.
 *
 * @remarks
 * Package names and project paths come from manifests, which anyone can edit, so every one goes through this.
 *
 * @param text - Any text; package names and project paths come from manifests, which anyone can edit.
 * @returns The text with the five markup characters replaced.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function escapeHtml (text: string): string {
  return text.replaceAll(/[&<>"']/g, character => HTML_ESCAPES[character] ?? character)
}

/**
 * Whether an address is one the page may link to.
 *
 * @remarks
 * A report entry's `link` is data from a child process; only `https:` is rendered as an anchor.
 *
 * @param link - An address from the CLI's report.
 * @returns `true` for an `https:` address; anything else (a `javascript:` URL, a relative path) is not rendered as a link.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function isSafeLink (link: string | undefined): link is string {
  return link !== undefined && /^https:\/\/[^\s"'<>]+$/.test(link)
}

/**
 * One table row of an update.
 *
 * @param update - The update.
 * @returns The row's HTML.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function row (update: UpdateDescription): string {
  const search = escapeHtml(`${update.name} ${update.projects.join(' ')}`.toLowerCase())
  const link = isSafeLink(update.link)
    ? `<a href="${escapeHtml(update.link)}" title="Open the page of ${escapeHtml(update.name)} ${escapeHtml(update.latest)}">Release page</a>`
    : '<span class="muted">no page</span>'

  return `<tr data-search="${search}">
    <td class="pick"><input type="checkbox" data-name="${escapeHtml(update.name)}" data-kind="${update.kind}" aria-label="Update ${escapeHtml(update.name)}"></td>
    <td class="name">${escapeHtml(update.name)}<span class="muted"> ${escapeHtml(update.sections.join('/'))}</span></td>
    <td class="versions">${escapeHtml(update.current)} <span class="arrow">›</span> <strong>${escapeHtml(update.latest)}</strong></td>
    <td class="projects">${update.projects.map(project => `<span class="chip">${escapeHtml(project)}</span>`).join(' ')}</td>
    <td class="link">${link}</td>
  </tr>`
}

/**
 * One section (patch, minor, ...) with its rows.
 *
 * @param definition - Which kind it holds and how it is titled.
 * @param updates - Every update of the page.
 * @returns The section's HTML, or an empty string when it holds none.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function section (definition: (typeof SECTIONS)[number], updates: readonly UpdateDescription[]): string {
  const rows = updates.filter(update => update.kind === definition.kind)
  if (rows.length === 0) {
    return ''
  }

  return `<section class="kind kind-${definition.kind}">
  <h2><label><input type="checkbox" data-group="${definition.kind}" aria-label="Select every ${definition.title.toLowerCase()} update"> ${definition.title} <span class="count">${rows.length}</span></label></h2>
  <p class="muted">${definition.blurb}</p>
  <table><tbody>${rows.map(entry => row(entry)).join('\n')}</tbody></table>
</section>`
}

const STYLE = `
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 16px 48px; }
  header { position: sticky; top: 0; background: var(--vscode-editor-background); padding: 12px 0; border-bottom: 1px solid var(--vscode-panel-border); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; z-index: 1; }
  header h1 { font-size: 1.2em; margin: 0 auto 0 0; font-weight: 600; }
  input[type=search] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 4px 8px; min-width: 14em; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; padding: 5px 12px; cursor: pointer; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: .5; cursor: default; }
  h2 { font-size: 1.05em; margin: 20px 0 0; }
  .count { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 10px; padding: 0 7px; font-size: .85em; }
  .muted { color: var(--vscode-descriptionForeground); }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  td.pick { width: 1.5em; }
  td.versions { white-space: nowrap; }
  .chip { display: inline-block; background: var(--vscode-textBlockQuote-background); border-radius: 3px; padding: 0 6px; margin: 1px 2px 1px 0; font-size: .9em; }
  .kind-major h2 { color: var(--vscode-editorWarning-foreground); }
  a { color: var(--vscode-textLink-foreground); }
  .empty { margin-top: 32px; }
  [hidden] { display: none !important; }
`

const SCRIPT = String.raw`
  const vscode = acquireVsCodeApi();
  const update = document.getElementById('update');
  const filter = document.getElementById('filter');
  const rows = () => [...document.querySelectorAll('tr[data-search]')];
  const boxes = () => [...document.querySelectorAll('input[data-name]')];
  const picked = () => boxes().filter(box => box.checked && !box.closest('tr').hidden);
  function sync () {
    const count = picked().length;
    update.disabled = count === 0;
    update.textContent = count === 0 ? 'Update selected' : 'Update ' + count + ' selected';
  }
  document.addEventListener('change', event => {
    const target = event.target;
    if (target.matches('input[data-group]')) {
      boxes().filter(box => box.dataset.kind === target.dataset.group && !box.closest('tr').hidden)
        .forEach(box => { box.checked = target.checked; });
    }
    sync();
  });
  filter.addEventListener('input', () => {
    const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
    rows().forEach(row => { row.hidden = !words.every(word => row.dataset.search.includes(word)); });
    sync();
  });
  document.getElementById('select-safe').addEventListener('click', () => {
    boxes().forEach(box => { box.checked = !box.closest('tr').hidden && (box.dataset.kind === 'patch' || box.dataset.kind === 'minor'); });
    sync();
  });
  update.addEventListener('click', () => {
    vscode.postMessage({ type: 'update', names: picked().map(box => box.dataset.name) });
  });
  document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  sync();
`

/**
 * The webview page listing the available updates.
 *
 * @remarks
 * Pure: it takes what the CLI answered and returns the document, so a test reads the HTML without a
 * webview. Nothing from the report is trusted as markup: names, projects and versions are escaped, and a
 * link is rendered only when it is an `https:` address. The page runs one inline script, allowed by the
 * policy's nonce alone, which only toggles checkboxes, filters rows and posts `{ type, names }` back.
 *
 * @param input - The updates, the nonce and the webview's CSP source.
 * @returns A complete HTML document.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function renderUpdatesPage (input: UpdatesPageInput): string {
  const { updates, nonce, cspSource } = input
  const policy = `default-src 'none'; style-src 'nonce-${nonce}' ${cspSource}; script-src 'nonce-${nonce}';`
  const body = updates.length === 0
    ? '<p class="empty">Every dependency is on its latest published release.</p>'
    : SECTIONS.map(entry => section(entry, updates)).join('\n')
  const count = updates.length === 1 ? '1 package has' : `${updates.length} packages have`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dependency updates</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<header>
  <h1>${updates.length === 0 ? 'Dependencies are up to date' : `${count} a newer release`}</h1>
  <input id="filter" type="search" placeholder="Filter by package or project" aria-label="Filter by package or project">
  <button id="select-safe" class="secondary" ${updates.length === 0 ? 'disabled' : ''}>Select patch and minor</button>
  <button id="refresh" class="secondary">Refresh</button>
  <button id="update" disabled>Update selected</button>
</header>
${body}
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`
}
