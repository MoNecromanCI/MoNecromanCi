import type { DebugTarget } from './debug-target.contract'

/**
 * The editor extension (and the tool behind it) that a debug launch needs.
 *
 * @remarks
 * Shown to the person when a project is added, since nothing in the workspace can install an editor extension.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface DebugExtension {
  /** The Marketplace identifier, as `code --install-extension` takes it. */
  readonly id:   string
  /** What it is called in the Extensions view. */
  readonly name: string
  /** What must also be on the machine, which the extension does not install. */
  readonly tool: string
}

/**
 * Which extension provides the debug adapter for a target.
 *
 * @remarks
 * A launch configuration with no adapter behind its `type` opens VS Code's "install an extension for this type" prompt at
 * best, so the add command says which one to install, as it does for Delve with Go.
 *
 * @param target - What the debugger is pointed at.
 * @returns The extension and the tool it drives.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function debugExtension (target: DebugTarget): DebugExtension {
  switch (target.language) {
    case 'cpp': {
      return { id: 'ms-vscode.cpptools', name: 'C/C++', tool: 'gdb (lldb on macOS) on PATH' }
    }
    case 'rust': {
      return { id: 'vadimcn.vscode-lldb', name: 'CodeLLDB', tool: 'a Rust toolchain; CodeLLDB brings its own LLDB' }
    }
    case 'jvm': {
      return { id: 'vscjava.vscode-java-pack', name: 'Extension Pack for Java', tool: 'a JDK 21 and the project imported by the Java language server' }
    }
    case 'php': {
      return { id: 'xdebug.php-debug', name: 'PHP Debug', tool: 'the Xdebug PHP extension, enabled in php.ini' }
    }
    case 'ruby': {
      return { id: 'KoichiSasada.vscode-rdbg', name: 'Ruby Debugger', tool: 'the debug gem (a default gem from Ruby 3.1)' }
    }
  }
}
