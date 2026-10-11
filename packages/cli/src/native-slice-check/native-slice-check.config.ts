/**
 * Where the native-language slice check lives in a workspace.
 *
 * @remarks
 * Also what the `slice-check` target of every Rust and C++ project runs.
 */
export const SLICE_CHECK_PATH = 'tools/slice-check.cjs'

/**
 * The `tools/slice-check.cjs` script: the Rust and C++ counterpart of the `vertical-slices/file-role` lint rule.
 *
 * @remarks
 * Vertical slices are one opinion across languages. For TypeScript the ESLint rule enforces them, and Go has its own check;
 * nothing looked at how Rust and C++ files are named or where they sit. This does, with the language mapping the rules give
 * them: a file is `<snake>_<role>` (a C++ test `<snake>_<role>_test`), the root of `src/` holds only the entry point
 * (`main.rs` and `lib.rs`; `main.cpp`), a slice's barrel is `mod.rs` or `<folder>.hpp`, and no folder is called `util`,
 * `helper`, `common`, `shared`, `manager`, `processor`, `data` or `misc`. Rust's own `tests/`, `benches/` and `examples/`
 * folders and `build.rs` are the tool's, so they are left alone. Written by mnci and rewritten by it, so a local edit does
 * not survive; a project that must differ writes the exception in its README and deletes its `slice-check` target.
 */
export const SLICE_CHECK_SCRIPT = String.raw`#!/usr/bin/env node
// Written by MoNecromanCI; mnci rewrites it, so local edits do not survive.
//
// node tools/slice-check.cjs <rust|cpp> <project directory>...
//
// The Rust and C++ counterpart of the vertical-slices/file-role lint rule: a file under src/ is <snake>_<role>
// (a C++ test <snake>_<role>_test), only the entry point sits at the root of src/, a slice's barrel is mod.rs (Rust) or
// <folder>.hpp (C++), and no folder is a junk drawer (util, helper, common, shared, manager, processor, data, misc).
// Exits 1 and names every violation.
'use strict'
const { existsSync, readdirSync } = require('node:fs')
const { extname, join, relative } = require('node:path')

const ROLES = ['handler', 'use_case', 'algorithm', 'policy', 'model', 'contract', 'mapper', 'validator', 'repository', 'client', 'store', 'middleware', 'error', 'config', 'enum']
const FORBIDDEN_FOLDERS = new Set(['util', 'utils', 'helper', 'helpers', 'common', 'shared', 'manager', 'processor', 'data', 'misc'])
const ROLE_STEM = '[a-z][a-z0-9]*(?:_[a-z0-9]+)*_(?:' + ROLES.join('|') + ')'

const LANGUAGES = {
  rust: {
    extensions: new Set(['.rs']),
    entryPoints: new Set(['main', 'lib']),
    isBarrel: (stem) => stem === 'mod',
    file: new RegExp('^' + ROLE_STEM + '$'),
    shape: '<snake>_<role>.rs',
  },
  cpp: {
    extensions: new Set(['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.h']),
    entryPoints: new Set(['main']),
    isBarrel: (stem, folder) => stem === folder,
    file: new RegExp('^' + ROLE_STEM + '(?:_test)?$'),
    shape: '<snake>_<role>.cpp (a test <snake>_<role>_test.cpp, a header .hpp)',
  },
}

function check (language, project) {
  const problems = []
  const source = join(project, 'src')
  if (!existsSync(source)) return problems
  function walk (directory, folder) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const shown = relative(project, path).replaceAll('\\', '/')
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue
        if (FORBIDDEN_FOLDERS.has(entry.name)) {
          problems.push(shown + '/ - "' + entry.name + '" is a junk drawer; name the folder for the outcome it serves')
          continue
        }
        walk(path, entry.name)
        continue
      }
      const extension = extname(entry.name)
      if (!language.extensions.has(extension)) continue
      const stem = entry.name.slice(0, -extension.length)
      if (directory === source) {
        if (!language.entryPoints.has(stem)) problems.push(shown + ' - only the entry point sits at the root of src/; move this into a slice folder')
      } else if (!language.file.test(stem) && !language.isBarrel(stem, folder)) {
        problems.push(shown + ' - a file is ' + language.shape + ' (roles: ' + ROLES.join(', ') + ')')
      }
    }
  }
  walk(source, 'src')

  return problems
}

const [name, ...projects] = process.argv.slice(2)
const language = LANGUAGES[name]
if (!language || projects.length === 0) {
  console.error('Usage: node tools/slice-check.cjs <rust|cpp> <project directory>...')
  process.exit(1)
}
let failed = 0
for (const project of projects) {
  const problems = check(language, project)
  for (const problem of problems) console.error(project + '/' + problem)
  failed += problems.length
}
if (failed > 0) {
  console.error(failed + ' file(s) break the vertical-slice layout. See the vertical-slice rules; an exception is written in the project README.')
  process.exit(1)
}
console.log(name + ' slice layout OK: ' + projects.join(', '))
`
