/**
 * What a workspace with Go projects needs from `nx.json`: the plugin that gives Nx its Go project graph.
 *
 * @remarks
 * The deliberate public API of this slice: a sibling reaches it only through this barrel.
 * It exists as its own slice, depending on `file-system` alone, because `mnci doctor`
 * and `mnci upgrade` need to ask and repair this without depending on the scaffolding
 * slice that adds projects, the same reason `rollup-library` exists.
 */

export { hasGoProject, isNxGoPluginRegistered, NX_GO_PLUGIN, registerNxGoPlugin } from './go-plugin.use-case'
