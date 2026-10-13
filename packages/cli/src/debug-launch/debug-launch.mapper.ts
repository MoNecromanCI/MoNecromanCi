import type { DebugNaming, DebugTarget } from './debug-target.contract'

/**
 * The label of the task that builds a project for debugging.
 *
 * @remarks
 * A launch configuration names it as `preLaunchTask`. Only C++ needs one: Cargo, the Java language server, PHP and Ruby
 * build or interpret on their own.
 *
 * @param naming - The workspace prefix and the project name.
 * @returns The task's label.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function debugBuildTaskLabel (naming: DebugNaming): string {
  return `${naming.prefix}${naming.projectName} build:dev`
}

/**
 * The launch configuration that debugs one project with its language's debug adapter.
 *
 * @remarks
 * The script entries run through `node-terminal`, which binds breakpoints in Node only. Every other language needs its own
 * adapter: `cppdbg` (C/C++ extension) for C++, `lldb` (CodeLLDB) for Rust, `java` (Debugger for Java) for Java and Kotlin,
 * `php` (PHP Debug, with Xdebug) and `rdbg` (the Ruby debugger gem). Those adapters are extensions the person installs;
 * `debugExtension` names them.
 *
 * Written, not run: no debug session was driven in an editor, so the entries follow each adapter's documented attributes
 * and the paths the kind's own targets produce, which are checked against a real build.
 *
 * @param naming - The workspace prefix and the project name.
 * @param workspaceFolder - The VS Code folder name, used to scope `${workspaceFolder}`.
 * @param target - What the debugger is pointed at.
 * @returns One launch configuration.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function debugLaunchConfiguration (naming: DebugNaming, workspaceFolder: string, target: DebugTarget): Record<string, unknown> {
  const root = `\${workspaceFolder:${workspaceFolder}}`
  const common = {
    request:      'launch',
    name:         `${naming.prefix}${naming.projectName} debug`,
    presentation: { group: 'mnci projects' },
  }
  switch (target.language) {
    case 'cpp': {
      return {
        ...common,
        type:          'cppdbg',
        program:       `${root}/${target.program}`,
        args:          [],
        cwd:           root,
        stopAtEntry:   false,
        MIMode:        'gdb',
        // Windows names the file `<name>.exe`, and macOS ships LLDB, not GDB.
        windows:       { program: `${root}/${target.program}.exe` },
        osx:           { MIMode: 'lldb' },
        preLaunchTask: debugBuildTaskLabel(naming),
      }
    }
    case 'rust': {
      return {
        ...common,
        type:  'lldb',
        cargo: {
          args:   ['build', '-p', target.crate, '--target-dir', target.targetDirectory],
          filter: { name: target.crate, kind: 'bin' },
        },
        cwd: root,
      }
    }
    case 'jvm': {
      return {
        ...common,
        type:      'java',
        mainClass: target.mainClass,
        cwd:       root,
      }
    }
    case 'php': {
      return {
        ...common,
        type:        'php',
        program:     `${root}/${target.program}`,
        cwd:         root,
        port:        9003,
        runtimeArgs: ['-dxdebug.mode=debug', '-dxdebug.start_with_request=yes'],
      }
    }
    case 'ruby': {
      return {
        ...common,
        type:          'rdbg',
        script:        `${root}/${target.script}`,
        cwd:           `${root}/${target.directory}`,
        useBundler:    true,
        askParameters: false,
      }
    }
  }
}

/**
 * The task a launch configuration runs first, when the language has no way to build on its own.
 *
 * @remarks
 * C++ is the one case: the debugger needs the Debug build `build-dev` makes, and nothing else produces it. The task runs
 * the project's own `<name>:build:dev` script from the workspace folder.
 *
 * @param naming - The workspace prefix and the project name.
 * @param workspaceFolder - The VS Code folder name, used to scope `${workspaceFolder}`.
 * @param target - What the debugger is pointed at.
 * @returns The task, or `undefined` for a language that builds by itself.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function debugBuildTask (naming: DebugNaming, workspaceFolder: string, target: DebugTarget): Record<string, unknown> | undefined {
  if (target.language !== 'cpp') {
    return undefined
  }

  return {
    label:          debugBuildTaskLabel(naming),
    type:           'shell',
    command:        `npm run ${naming.projectName}:build:dev`,
    options:        { cwd: `\${workspaceFolder:${workspaceFolder}}` },
    problemMatcher: [],
    presentation:   { reveal: 'silent', panel: 'shared' },
  }
}
