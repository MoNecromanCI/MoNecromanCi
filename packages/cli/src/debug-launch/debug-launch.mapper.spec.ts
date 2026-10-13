import { debugBuildTask, debugBuildTaskLabel, debugLaunchConfiguration } from './debug-launch.mapper'
import type { DebugNaming } from './debug-target.contract'

const naming: DebugNaming = { prefix: 'mnci: ', projectName: 'greeter' }

describe('debugLaunchConfiguration', () => {
  it('points the C/C++ debugger at the Debug executable, with Windows and macOS overrides', () => {
    const configuration = debugLaunchConfiguration(naming, 'ws', { language: 'cpp', program: 'dist/cmake/greeter-debug/greeter' })

    expect(configuration).toMatchObject({
      type:          'cppdbg',
      name:          'mnci: greeter debug',
      program:       '${workspaceFolder:ws}/dist/cmake/greeter-debug/greeter',
      windows:       { program: '${workspaceFolder:ws}/dist/cmake/greeter-debug/greeter.exe' },
      osx:           { MIMode: 'lldb' },
      MIMode:        'gdb',
      preLaunchTask: 'mnci: greeter build:dev',
    })
  })

  it('has CodeLLDB build the crate into the project target directory and find its binary', () => {
    const configuration = debugLaunchConfiguration(naming, 'ws', { language: 'rust', crate: 'greeter', targetDirectory: 'dist/target/greeter' })

    expect(configuration).toMatchObject({
      type:  'lldb',
      cargo: {
        args:   ['build', '-p', 'greeter', '--target-dir', 'dist/target/greeter'],
        filter: { name: 'greeter', kind: 'bin' },
      },
    })
    expect(configuration).not.toHaveProperty('preLaunchTask')
  })

  it('launches a JVM main class, which is the same for Java and for Kotlin', () => {
    const configuration = debugLaunchConfiguration(naming, 'ws', { language: 'jvm', mainClass: 'com.example.greeter.MainKt' })

    expect(configuration).toMatchObject({ type: 'java', mainClass: 'com.example.greeter.MainKt', request: 'launch' })
  })

  it('runs a PHP script under Xdebug without needing php.ini to start a session', () => {
    const configuration = debugLaunchConfiguration(naming, 'ws', { language: 'php', program: 'apps/greeter/bin/greeter.php' })

    expect(configuration).toMatchObject({
      type:        'php',
      program:     '${workspaceFolder:ws}/apps/greeter/bin/greeter.php',
      port:        9003,
      runtimeArgs: ['-dxdebug.mode=debug', '-dxdebug.start_with_request=yes'],
    })
  })

  it('runs a Ruby script through the project bundle from its own directory', () => {
    const configuration = debugLaunchConfiguration(naming, 'ws', { language: 'ruby', script: 'apps/greeter/bin/greeter', directory: 'apps/greeter' })

    expect(configuration).toMatchObject({
      type:       'rdbg',
      script:     '${workspaceFolder:ws}/apps/greeter/bin/greeter',
      cwd:        '${workspaceFolder:ws}/apps/greeter',
      useBundler: true,
    })
  })

  it('groups every entry with the other mnci project entries, under the name the registration replaces by', () => {
    for (const target of [
      { language: 'cpp', program: 'p' },
      { language: 'rust', crate: 'c', targetDirectory: 't' },
      { language: 'jvm', mainClass: 'm' },
      { language: 'php', program: 'p' },
      { language: 'ruby', script: 's', directory: 'd' },
    ] as const) {
      const configuration = debugLaunchConfiguration(naming, 'ws', target)

      expect(configuration.name).toBe('mnci: greeter debug')
      expect(configuration.presentation).toEqual({ group: 'mnci projects' })
    }
  })
})

describe('debugBuildTask', () => {
  it('builds the Debug tree for C++ by the same label the launch names', () => {
    const task = debugBuildTask(naming, 'ws', { language: 'cpp', program: 'p' })

    expect(task).toMatchObject({
      label:   debugBuildTaskLabel(naming),
      command: 'npm run greeter:build:dev',
      options: { cwd: '${workspaceFolder:ws}' },
    })
  })

  it('has no task for a language that builds on its own', () => {
    expect(debugBuildTask(naming, 'ws', { language: 'rust', crate: 'c', targetDirectory: 't' })).toBeUndefined()
    expect(debugBuildTask(naming, 'ws', { language: 'jvm', mainClass: 'm' })).toBeUndefined()
    expect(debugBuildTask(naming, 'ws', { language: 'php', program: 'p' })).toBeUndefined()
    expect(debugBuildTask(naming, 'ws', { language: 'ruby', script: 's', directory: 'd' })).toBeUndefined()
  })
})
