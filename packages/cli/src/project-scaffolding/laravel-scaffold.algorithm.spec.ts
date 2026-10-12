import { addGreetRoute, forceTestEnvironment, holdsNoCode, laravelExampleFiles, laravelPhpStanConfig, laravelTargets } from './laravel-scaffold.algorithm'

const WEB = String.raw`<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});
`

describe('addGreetRoute', () => {
  it('imports the use case after the Route facade and appends the route', () => {
    const next = addGreetRoute(WEB)

    expect(next).toContain('use App\\Features\\Greeting\\GreetUseCase;\nuse Illuminate\\Support\\Facades\\Route;')
    expect(next).toContain("Route::get('/hello/{name}'")
    expect(next.endsWith(';\n')).toBe(true)
  })

  it('is idempotent', () => {
    const once = addGreetRoute(WEB)

    expect(addGreetRoute(once)).toBe(once)
  })

  it('keeps CRLF line endings', () => {
    const next = addGreetRoute(WEB.replaceAll('\n', '\r\n'))

    expect(next).not.toMatch(/[^\r]\n/)
  })
})

describe('laravelExampleFiles', () => {
  it('puts the use case in a feature folder beside the framework folders, with a unit and a route test', () => {
    expect(Object.keys(laravelExampleFiles()).sort((a, b) => a.localeCompare(b))).toEqual([
      'app/Features/Greeting/GreetingContract.php',
      'app/Features/Greeting/GreetUseCase.php',
      'tests/Feature/GreetRouteTest.php',
      'tests/Unit/GreetUseCaseTest.php',
    ])
  })
})

describe('forceTestEnvironment', () => {
  const XML = ['<php>', '  <env name="APP_ENV" value="testing"/>', '</php>'].join('\n')

  it('forces an entry in both the environment and the server variables', () => {
    expect(forceTestEnvironment(XML)).toBe(
      ['<php>', '  <env force="true" name="APP_ENV" value="testing"/>', '  <server force="true" name="APP_ENV" value="testing"/>', '</php>'].join('\n'),
    )
  })

  it('is idempotent', () => {
    const once = forceTestEnvironment(XML)

    expect(forceTestEnvironment(once)).toBe(once)
  })
})

describe('laravelPhpStanConfig', () => {
  it('includes the Larastan extension', () => {
    expect(laravelPhpStanConfig()).toContain('vendor/larastan/larastan/extension.neon')
  })
})

describe('laravelTargets', () => {
  it('runs the app own tools from the app and wires no slice check', () => {
    const targets = laravelTargets('blog', 'apps/blog') as Record<string, { options: { cwd?: string, command?: string, commands?: string[] } }>

    expect(Object.keys(targets).sort((a, b) => a.localeCompare(b))).toEqual(['build', 'lint', 'package', 'start', 'test'])
    expect(targets.test.options).toEqual({ command: 'php artisan test', cwd: 'apps/blog' })
    expect(targets.start.options.command).toBe('php artisan serve')
    expect(targets.lint.options.commands).toEqual(['php vendor/bin/pint --test', 'php vendor/bin/phpstan analyse -c phpstan.neon --no-progress'])
  })
})

describe('holdsNoCode', () => {
  it('is true for nothing, whitespace and comments alone', () => {
    expect(holdsNoCode('')).toBe(true)
    expect(holdsNoCode('  \n')).toBe(true)
    expect(holdsNoCode('//\n')).toBe(true)
    expect(holdsNoCode('/* a\n b */\n// c\n')).toBe(true)
  })

  it('is false when any code is present', () => {
    expect(holdsNoCode('// a\nexport {}\n')).toBe(false)
    expect(holdsNoCode("import './bootstrap'\n")).toBe(false)
  })
})
