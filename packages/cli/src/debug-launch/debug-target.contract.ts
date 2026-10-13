/**
 * What a project's debugger has to be pointed at, by language.
 *
 * @remarks
 * Each shape holds only what the language's debug adapter needs and that the kind's own scaffolding already knows: a
 * program built with symbols for C++, a crate for Rust, a main class for the JVM (Java and Kotlin), a script for PHP and
 * Ruby. Paths are relative to the workspace root, with `/` as the separator.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type DebugTarget =
  | CppDebugTarget |
  RustDebugTarget |
  JvmDebugTarget |
  PhpDebugTarget |
  RubyDebugTarget

/**
 * A C++ executable built by the project's `build-dev` target.
 *
 * @remarks
 * Needs a Debug build to have symbols, so the launch runs `build-dev` first.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface CppDebugTarget {
  readonly language: 'cpp'
  /** The executable, without the `.exe` Windows adds: `dist/cmake/<name>-debug/<name>`. */
  readonly program:  string
}

/**
 * A Rust binary, built and found by the debugger through `cargo`.
 *
 * @remarks
 * CodeLLDB runs the `cargo build` itself and reads the binary's path from it, so no task builds it first.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface RustDebugTarget {
  readonly language:        'rust'
  /** The Cargo package, which is also the binary's name. */
  readonly crate:           string
  /** The project's own `--target-dir`, so a build does not touch another crate's artifacts. */
  readonly targetDirectory: string
}

/**
 * A JVM application's main class, for Java and for Kotlin (whose `Main.kt` compiles to `MainKt`).
 *
 * @remarks
 * The Java debugger compiles through the language server's own project import, so no task builds it first.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface JvmDebugTarget {
  readonly language:  'jvm'
  /** The fully qualified class with `main`. */
  readonly mainClass: string
}

/**
 * A PHP script run under Xdebug.
 *
 * @remarks
 * Nothing is built: the adapter starts `php` with Xdebug's request mode on and listens on its port.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface PhpDebugTarget {
  readonly language: 'php'
  /** The entry script: `apps/<name>/bin/<name>.php`. */
  readonly program:  string
}

/**
 * A Ruby script run under `rdbg`, inside the project's own bundle.
 *
 * @remarks
 * Each Ruby project has its own `Gemfile`, so the adapter runs from the project's directory with Bundler.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface RubyDebugTarget {
  readonly language:  'ruby'
  /** The entry script: `apps/<name>/bin/<name>`. */
  readonly script:    string
  /** The project's directory, which is where its `Gemfile` is. */
  readonly directory: string
}

/**
 * The names an entry in the workspace file is given.
 *
 * @remarks
 * `prefix` is the workspace's own (`mnci: `), so the entries are found and replaced by exact name when a project is
 * registered again, as the script entries are.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface DebugNaming {
  /** The prefix every mnci-owned launch configuration and task carries. */
  readonly prefix:      string
  /** The Nx project name. */
  readonly projectName: string
}
