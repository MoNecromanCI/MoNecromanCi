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
// node tools/slice-check.cjs <rust|cpp|java|php|ruby> <project directory>...
//
// The Rust and C++ counterpart of the vertical-slices/file-role lint rule: a file under src/ is <snake>_<role>
// (a C++ test <snake>_<role>_test), only the entry point sits at the root of src/, a slice's barrel is mod.rs (Rust) or
// <folder>.hpp (C++), and no folder is a junk drawer; Java: a type is <Name><Role>.java inside its package; PHP: a class is <Name><Role>.php in a StudlyCase folder (util, helper, common, shared, manager, processor, data, misc).
// Exits 1 and names every violation.
'use strict'
const { existsSync, readdirSync, readFileSync } = require('node:fs')
const { extname, join, relative } = require('node:path')

const ROLES = ['handler', 'use_case', 'algorithm', 'policy', 'model', 'contract', 'mapper', 'validator', 'repository', 'client', 'store', 'middleware', 'error', 'config', 'enum']
const FORBIDDEN_FOLDERS = new Set(['util', 'utils', 'helper', 'helpers', 'common', 'shared', 'manager', 'processor', 'data', 'misc'])
const ROLE_STEM = '[a-z][a-z0-9]*(?:_[a-z0-9]+)*_(?:' + ROLES.join('|') + ')'

const LANGUAGES = {
  rust: {
    extensions:  new Set(['.rs']),
    entryPoints: new Set(['main', 'lib']),
    isBarrel:    (stem) => stem === 'mod',
    file:        new RegExp('^' + ROLE_STEM + '$'),
    shape:       '<snake>_<role>.rs',
  },
  cpp: {
    extensions:  new Set(['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.h']),
    entryPoints: new Set(['main']),
    isBarrel:    (stem, folder) => stem === folder,
    file:        new RegExp('^' + ROLE_STEM + '(?:_test)?$'),
    shape:       '<snake>_<role>.cpp (a test <snake>_<role>_test.cpp, a header .hpp)',
  },
}

function check (language, project) {
  const problems = []
  const source = join(project, 'src')
  if (!existsSync(source)) return problems
  function walk (directory, folder) {
    const entries = readdirSync(directory, { withFileTypes: true })
    for (const entry of entries) {
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

const JAVA_ROLES = ['Handler', 'UseCase', 'Algorithm', 'Policy', 'Model', 'Contract', 'Mapper', 'Validator', 'Repository', 'Client', 'Store', 'Middleware', 'Error', 'Config', 'Enum']
const JAVA_ENTRY_POINTS = new Set(['Main', 'package-info'])
const JAVA_TYPE = new RegExp('^[A-Z][A-Za-z0-9]*(?:' + JAVA_ROLES.join('|') + ')(?:Test)?$')

// Java mandates a file named for its one public type, so the role sits in the type name (as it does for C#), and a package is
// a slice. The base package is the pom's groupId plus its artifactId with every character that is not a letter or digit
// removed, which is what the scaffold wrote.
function javaBase (project) {
  const pom = join(project, 'pom.xml')
  if (!existsSync(pom)) return
  const text = readFileSync(pom, 'utf8')
  const own = text.replace(/<parent>[\s\S]*?<\/parent>/, '').split(/<(?:dependencies|dependencyManagement|build|profiles|properties)\b/, 1)[0]
  const group = (/<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(own) || /<parent>[\s\S]*?<groupId>\s*([^<\s]+)/.exec(text) || [])[1]
  const artifact = (/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(own) || [])[1]
  if (!group || !artifact) return
  let segment = artifact.toLowerCase().replaceAll(/[^a-z0-9]+/g, '')
  if (/^\d/.test(segment)) segment = '_' + segment

  return [...group.split('.'), segment]
}

function checkJava (project) {
  const problems = []
  const base = javaBase(project)
  if (!base) return problems
  for (const tree of ['src/main/java', 'src/test/java']) {
    const root = join(project, ...tree.split('/'))
    if (!existsSync(root)) continue
    const baseDirectory = join(root, ...base)
    function walk (directory, depth) {
      const entries = readdirSync(directory, { withFileTypes: true })
      for (const entry of entries) {
        const path = join(directory, entry.name)
        const shown = relative(project, path).replaceAll('\\', '/')
        if (entry.isDirectory()) {
          if (FORBIDDEN_FOLDERS.has(entry.name)) {
            problems.push(shown + '/ - "' + entry.name + '" is a junk drawer; name the package for the outcome it serves')
          } else if (/^[a-z_][a-z0-9]*$/.test(entry.name)) {
            walk(path, depth + 1)
          } else {
            problems.push(shown + '/ - a package is one lowercase word')
          }
          continue
        }
        if (extname(entry.name) !== '.java') continue
        const stem = entry.name.slice(0, -'.java'.length)
        if (depth === 0) {
          if (!JAVA_ENTRY_POINTS.has(stem)) problems.push(shown + ' - only the entry point sits at the root of the base package; move this into a slice package')
        } else if (stem !== 'package-info' && !JAVA_TYPE.test(stem)) {
          problems.push(shown + ' - a type is <Name><Role>.java (roles: ' + JAVA_ROLES.join(', ') + '; a test <Name><Role>Test.java)')
        }
      }
    }
    if (existsSync(baseDirectory)) {
      walk(baseDirectory, 0)
    }
    // Anything outside the base package is a file the layout cannot place.
    const outside = (directory, parts) => {
      const entries = readdirSync(directory, { withFileTypes: true })
      for (const entry of entries) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
          if (parts.length < base.length && entry.name === base[parts.length]) {
            outside(path, [...parts, entry.name])
          } else if (parts.length < base.length) {
            problems.push(relative(project, path).replaceAll('\\', '/') + '/ - sources live under the package ' + base.join('.'))
          }
        } else if (extname(entry.name) === '.java' && parts.length < base.length) {
          problems.push(relative(project, path).replaceAll('\\', '/') + ' - sources live under the package ' + base.join('.'))
        }
      }
    }
    outside(root, [])
  }

  return problems
}

// PHP: PSR-4 names a class file for its one class, so the role is in the class name and the folder and namespace are the
// slice: src/<Slice>/<Name><Role>.php, a test tests/<Slice>/<Name><Role>Test.php. Nothing sits at the root of src/ (an
// app's entry script is bin/<name>.php, outside it); tests/ may hold one SmokeTest at its root.
const PHP_CLASS = new RegExp('^[A-Z][A-Za-z0-9]*(?:' + JAVA_ROLES.join('|') + ')(?:Test)?$')

function checkPhp (project) {
  const problems = []
  for (const tree of ['src', 'tests']) {
    const root = join(project, tree)
    if (!existsSync(root)) continue
    const walk = (directory, depth) => {
      const entries = readdirSync(directory, { withFileTypes: true })
      for (const entry of entries) {
        const path = join(directory, entry.name)
        const shown = relative(project, path).replaceAll('\\', '/')
        if (entry.isDirectory()) {
          if (FORBIDDEN_FOLDERS.has(entry.name.toLowerCase())) {
            problems.push(shown + '/ - "' + entry.name + '" is a junk drawer; name the folder for the outcome it serves')
          } else if (/^[A-Z][A-Za-z0-9]*$/.test(entry.name)) {
            walk(path, depth + 1)
          } else {
            problems.push(shown + '/ - a slice folder is StudlyCase, like its namespace')
          }
          continue
        }
        if (extname(entry.name) !== '.php') continue
        const stem = entry.name.slice(0, -'.php'.length)
        if (depth === 0) {
          if (tree === 'src' || stem !== 'SmokeTest') problems.push(shown + ' - nothing sits at the root of ' + tree + '/; move this into a slice folder')
        } else if (!PHP_CLASS.test(stem)) {
          problems.push(shown + ' - a class is <Name><Role>.php (roles: ' + JAVA_ROLES.join(', ') + '; a test <Name><Role>Test.php)')
        }
      }
    }
    walk(root, 0)
  }

  return problems
}

// Ruby: its own convention is the slice one, a snake_case file per constant. lib/<name>.rb is the barrel (a file at the
// root of lib/ must be named for a folder beside it), lib/<name>/version.rb is the gem's version, a slice is a snake_case
// folder under lib/<name>/, a file is <snake>_<role>.rb, and a spec is the same name with _spec under spec/ (with
// spec_helper.rb, and one smoke_spec.rb for a bare project).
const RUBY_FILE = new RegExp('^' + ROLE_STEM + '$')

function checkRuby (project) {
  const problems = []
  const lib = join(project, 'lib')
  const spec = join(project, 'spec')
  const walk = (directory, depth, kind) => {
    const entries = readdirSync(directory, { withFileTypes: true })
    const folders = new Set(entries.filter(entry => entry.isDirectory()).map(entry => entry.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      const shown = relative(project, path).replaceAll('\\', '/')
      if (entry.isDirectory()) {
        if (FORBIDDEN_FOLDERS.has(entry.name)) {
          problems.push(shown + '/ - "' + entry.name + '" is a junk drawer; name the folder for the outcome it serves')
        } else if (/^[a-z_][a-z0-9_]*$/.test(entry.name)) {
          walk(path, depth + 1, kind)
        } else {
          problems.push(shown + '/ - a folder is snake_case, like the file it requires')
        }
        continue
      }
      if (extname(entry.name) !== '.rb') continue
      const stem = entry.name.slice(0, -'.rb'.length)
      if (kind === 'lib') {
        const isVersion = depth === 1 && stem === 'version'
        if (depth === 0) {
          if (!folders.has(stem)) problems.push(shown + ' - only the barrel, named for the folder beside it, sits at the root of lib/')
        } else if (!isVersion && !RUBY_FILE.test(stem)) {
          problems.push(shown + ' - a file is <snake>_<role>.rb (roles: ' + ROLES.join(', ') + ')')
        }
      } else {
        const isHelper = depth === 0 && (stem === 'spec_helper' || stem === 'smoke_spec')
        const isRoleSpec = stem.endsWith('_spec') && RUBY_FILE.test(stem.slice(0, -'_spec'.length))
        if (!isHelper && !isRoleSpec) {
          problems.push(shown + ' - a spec is <snake>_<role>_spec.rb (roles: ' + ROLES.join(', ') + ')')
        }
      }
    }
  }
  if (existsSync(lib)) walk(lib, 0, 'lib')
  if (existsSync(spec)) walk(spec, 0, 'spec')

  return problems
}

const [name, ...projects] = process.argv.slice(2)
const CHECKERS = { java: { check: checkJava }, php: { check: checkPhp }, ruby: { check: checkRuby } }
const language = CHECKERS[name] || LANGUAGES[name]
if (!language || projects.length === 0) {
  console.error('Usage: node tools/slice-check.cjs <rust|cpp|java|php|ruby> <project directory>...')
  process.exit(1)
}
let failed = 0
for (const project of projects) {
  const problems = language.check ? language.check(project) : check(language, project)
  for (const problem of problems) console.error(project + '/' + problem)
  failed += problems.length
}
if (failed > 0) {
  console.error(failed + ' file(s) break the vertical-slice layout. See the vertical-slice rules; an exception is written in the project README.')
  process.exit(1)
}
console.log(name + ' slice layout OK: ' + projects.join(', '))
`
