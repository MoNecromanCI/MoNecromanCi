/** The PHPStan level a Laravel app is checked at; Larastan's own recommended start, since the framework's magic needs its extension. */
const LARASTAN_LEVEL = 5

/**
 * The files of a Laravel app's worked example, as paths relative to the app to contents.
 *
 * @remarks
 * Laravel mandates `app/Http`, `app/Models`, `routes/` and `database/`, so the framework's own folders stay as they are
 * and the example lives beside them in `app/Features/Greeting`: a contract and a use case in the PHP mapping of the
 * vertical-slice rules (the role in the class name), which the route calls, so no logic sits in a closure or controller.
 * Both tests are Laravel's own shapes: a plain PHPUnit case for the use case and a `Tests\TestCase` for the route.
 *
 * @param None - this function takes no parameters.
 * @returns The files to write.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function laravelExampleFiles (): Record<string, string> {
  return {
    'app/Features/Greeting/GreetingContract.php': String.raw`<?php

declare(strict_types=1);

namespace App\Features\Greeting;

/** What greeting someone returns. */
final readonly class GreetingContract
{
    public function __construct(public string $message) {}
}
`,
    'app/Features/Greeting/GreetUseCase.php': String.raw`<?php

declare(strict_types=1);

namespace App\Features\Greeting;

/** Greets a name; a blank one is greeted as a stranger. */
final class GreetUseCase
{
    public static function greet(string $name): GreetingContract
    {
        $who = trim($name) === '' ? 'stranger' : trim($name);

        return new GreetingContract('Hello, '.$who.'!');
    }
}
`,
    'tests/Unit/GreetUseCaseTest.php': String.raw`<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Features\Greeting\GreetUseCase;
use PHPUnit\Framework\TestCase;

final class GreetUseCaseTest extends TestCase
{
    public function test_it_greets_a_name(): void
    {
        $this->assertSame('Hello, Ada!', GreetUseCase::greet('Ada')->message);
    }

    public function test_it_greets_a_blank_name_as_a_stranger(): void
    {
        $this->assertSame('Hello, stranger!', GreetUseCase::greet('   ')->message);
    }
}
`,
    'tests/Feature/GreetRouteTest.php': String.raw`<?php

declare(strict_types=1);

namespace Tests\Feature;

use Tests\TestCase;

final class GreetRouteTest extends TestCase
{
    public function test_the_hello_route_returns_the_greeting(): void
    {
        $this->get('/hello/Ada')->assertOk()->assertJson(['message' => 'Hello, Ada!']);
    }
}
`,
  }
}

/**
 * Adds the worked example's route to Laravel's `routes/web.php`.
 *
 * @remarks
 * The file is the framework's own, so it is edited rather than replaced: the import goes after the `Route` facade import
 * the skeleton already has, and the route is appended. Idempotent, and a file that already names the use case is returned
 * unchanged.
 *
 * @param text - The text of `routes/web.php`.
 * @returns The text with the route added.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function addGreetRoute (text: string): string {
  if (text.includes('GreetUseCase')) {
    return text
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const route = [
    '',
    "Route::get('/hello/{name}', fn (string $name) => response()->json(['message' => GreetUseCase::greet($name)->message]));",
    '',
  ].join(newline)
  const anchor = String.raw`use Illuminate\Support\Facades\Route;`
  const withImport = text.includes(anchor)
    ? text.replace(anchor, () => String.raw`use App\Features\Greeting\GreetUseCase;${newline}${anchor}`)
    : text

  return `${withImport.replace(/\s+$/, '')}${newline}${route}`
}

/**
 * Makes the test environment the skeleton's `phpunit.xml` declares win over the process environment.
 *
 * @remarks
 * Nx loads a project's `.env` into the environment of every task, so `php artisan test` ran with `SESSION_DRIVER=database`
 * against the `:memory:` database the test configuration sets, and every request answered 500 (`no such table: sessions`,
 * measured: the skeleton's own example test failed under `nx run` and passed from a shell). PHPUnit's `<env>` leaves an
 * existing variable alone, and `force="true"` replaces `$_ENV` and `putenv` but not `$_SERVER`, which is what Laravel reads
 * first. So each entry is forced in both places. That makes the tests independent of whatever `.env` or the shell holds,
 * which is what a test configuration is for. Idempotent.
 *
 * @param text - The text of `phpunit.xml`.
 * @returns The text with every `<env name value/>` forced, and mirrored as a forced `<server>`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function forceTestEnvironment (text: string): string {
  return text.replaceAll(
    /^([ \t]*)<env (name="[^"]*" value="[^"]*")[ \t]*\/>$/gm,
    (_match, indent: string, attributes: string) => `${indent}<env force="true" ${attributes}/>\n${indent}<server force="true" ${attributes}/>`,
  )
}

/**
 * Says whether a JavaScript file holds nothing but whitespace and comments.
 *
 * @remarks
 * The skeleton's `resources/js/app.js` is comments only (Laravel 13 ships `//`), which `unicorn/no-empty-file` reports as
 * empty, exactly like a zero-byte file (measured by the e2e). A file with any code is left alone.
 *
 * @param text - The text of the file.
 * @returns True when there is no code, only whitespace and comments.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function holdsNoCode (text: string): boolean {
  return text.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '').trim() === ''
}

/**
 * A Laravel app's `phpstan.neon`.
 *
 * @remarks
 * Includes Larastan's extension, so facades and Eloquent resolve.
 *
 * @param None - this function takes no parameters.
 * @returns The text of `phpstan.neon`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function laravelPhpStanConfig (): string {
  return `includes:
    - vendor/larastan/larastan/extension.neon

parameters:
    level: ${LARASTAN_LEVEL}
    paths:
        - app
        - routes
`
}

/**
 * The targets of a Laravel app, written explicitly because nothing infers them.
 *
 * @remarks
 * Laravel's own tools run from the app: its PHPUnit (`php artisan test`), Pint and Larastan are the app's `require-dev`, so
 * unlike a plain PHP project nothing is shared from the workspace root and no `php-tools` task is waited for. There is no
 * `slice-check`: the framework mandates its folder names and the class naming of controllers, models and providers, so the
 * check would reject the skeleton (the exception is written in the CLI README).
 *
 * @param name - The project name.
 * @param directory - The project's workspace-relative directory.
 * @returns The Nx targets to merge into the project's `project.json`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function laravelTargets (name: string, directory: string): Record<string, unknown> {
  return {
    build: {
      cache:    true,
      executor: 'nx:run-commands',
      inputs:   ['default', '{projectRoot}/composer.lock'],
      outputs:  [`{workspaceRoot}/${directory}/vendor`],
      options:  { command: 'composer --no-interaction --no-progress install', cwd: directory },
    },
    test: {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      options:   { command: 'php artisan test', cwd: directory },
    },
    lint: {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      options:   {
        commands: ['php vendor/bin/pint --test', 'php vendor/bin/phpstan analyse -c phpstan.neon --no-progress'],
        cwd:      directory,
        parallel: false,
      },
    },
    start: {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      options:   { command: 'php artisan serve', cwd: directory },
    },
    package: {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      outputs:   [`{workspaceRoot}/dist/drop/php-app-${name}.zip`],
      options:   {
        command: `node -e "const fs=require('node:fs');fs.mkdirSync('dist/drop',{recursive:true});const A=require('adm-zip');const z=new A();const keep=p=>!p.endsWith('.sqlite');for(const d of ['app','bootstrap','config','database','public','resources','routes','storage','vendor'])if(fs.existsSync('${directory}/'+d))z.addLocalFolder('${directory}/'+d,d,keep);for(const f of ['artisan','composer.json','composer.lock','.env.example'])if(fs.existsSync('${directory}/'+f))z.addLocalFile('${directory}/'+f);z.writeZip('dist/drop/php-app-${name}.zip')"`,
      },
    },
  }
}
