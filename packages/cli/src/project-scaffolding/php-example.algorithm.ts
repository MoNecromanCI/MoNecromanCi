import { PHP_DEV_TOOLS, PHP_MIN_VERSION, PHPSTAN_LEVEL } from './php-build.config'

/**
 * The three PHP project kinds.
 *
 * @remarks
 * They differ in where they live and whether they have an entry script.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type PhpKind = 'php-app' | 'php-lib' | 'php-internal-lib'

/**
 * A name in StudlyCase, which is how PHP spells a namespace segment.
 *
 * @remarks
 * Every run of characters that is not a letter or digit is a word boundary, so `my-tool` and `my_tool` are both `MyTool`.
 *
 * @param value - A project name or an organisation (`my-tool`, `acme`).
 * @returns The words joined with each one capitalised (`MyTool`, `Acme`), prefixed with `_` when it would start with a digit.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function phpStudly (value: string): string {
  const studly = value
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')

  return /^\d/.test(studly) ? `_${studly}` : studly
}

/**
 * The Composer vendor every project's package name starts with, from the git origin.
 *
 * @remarks
 * Packagist names are `<vendor>/<package>`, lowercase with hyphens. The organisation of the repository is the vendor
 * (`github.com/Acme/tools` is `acme`), `app` when there is no origin to read it from.
 *
 * @param prefix - The repository's `<host>/<org>/<repo>` path, as the Go module prefix is, or `undefined`.
 * @returns A lowercase vendor name.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function phpVendor (prefix: string | undefined): string {
  const organisation = (prefix ?? '').split('/', 2)[1] ?? ''
  const vendor = organisation.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '')

  return vendor.length > 0 ? vendor : 'app'
}

/**
 * The root namespace of a project: its vendor and its name in StudlyCase.
 *
 * @remarks
 * PSR-4 maps it to the project's `src/` directory.
 *
 * @param vendor - The Composer vendor.
 * @param name - The project name.
 * @returns For example `Acme\MyTool`, written with a single backslash.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function phpNamespace (vendor: string, name: string): string {
  return `${phpStudly(vendor)}\\${phpStudly(name)}`
}

/**
 * Serialises a `composer.json` the way Composer itself does: four spaces, slashes and unicode unescaped.
 *
 * @param value - The manifest.
 * @returns The text, ending in a newline.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function composerJson (value: Record<string, unknown>): string {
  return `${JSON.stringify(value, undefined, 4)}\n`
}

/**
 * The root `composer.json` that holds the shared dev tools.
 *
 * @remarks
 * It declares no application code, only `require-dev`. `vendor/bin` here is where every project's `test` and `lint`
 * find PHPUnit, PHPStan and PHP_CodeSniffer.
 *
 * @param vendor - The Composer vendor.
 * @returns The text of `composer.json`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function phpRootComposerJson (vendor: string): string {
  return composerJson({
    'name':        `${vendor}/workspace`,
    'description': 'Shared PHP dev tools for this workspace (written by MoNecromanCI).',
    'type':        'project',
    'license':     'proprietary',
    'require-dev': PHP_DEV_TOOLS,
    'config':      { 'sort-packages': true },
  })
}

/**
 * A project's `composer.json`.
 *
 * @remarks
 * PSR-4 maps the project's namespace to `src/` and `<namespace>\Tests` to `tests/`. The version of a publishable library
 * is under `extra.mnci`: Composer takes a published package's version from its git tag, and its `version` key makes
 * `composer validate --strict` warn, but `nx release` needs a manifest to read and write, so it lives where Composer
 * ignores it.
 *
 * @param kind - Which PHP kind.
 * @param vendor - The Composer vendor.
 * @param name - The project name.
 * @returns The text of `composer.json`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function phpProjectComposerJson (kind: PhpKind, vendor: string, name: string): string {
  const namespace = phpNamespace(vendor, name)

  return composerJson({
    'name':         `${vendor}/${name}`,
    'description':  name,
    'type':         kind === 'php-app' ? 'project' : 'library',
    'license':      'proprietary',
    'require':      { php: `>=${PHP_MIN_VERSION}` },
    'autoload':     { 'psr-4': { [`${namespace}\\`]: 'src/' } },
    'autoload-dev': { 'psr-4': { [`${namespace}\\Tests\\`]: 'tests/' } },
    'config':       { 'sort-packages': true },
    ...((kind === 'php-lib') && { extra: { mnci: { version: '0.1.0' } } }),
  })
}

/**
 * A project's `phpunit.xml.dist`: one test suite over `tests/`, strict about warnings and risky tests.
 *
 * @remarks
 * The bootstrap is the project's own `vendor/autoload.php`, which is why PHPUnit (installed once at the root) can run any
 * project: the config names the autoloader of the code under test.
 *
 * @param name - The project name, which names the suite.
 * @returns The text of `phpunit.xml.dist`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function phpUnitConfig (name: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" bootstrap="vendor/autoload.php" colors="false" failOnWarning="true" failOnRisky="true">
    <testsuites>
        <testsuite name="${name}">
            <directory>tests</directory>
        </testsuite>
    </testsuites>
</phpunit>
`
}

/**
 * A project's `phpstan.neon`.
 *
 * @remarks
 * The autoloader is a bootstrap file so classes of the project and of the libraries it requires resolve when PHPStan runs
 * from the workspace root.
 *
 * @param app - Whether the project has a `bin/` entry script to analyse as well.
 * @returns The text of `phpstan.neon`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function phpStanConfig (app: boolean): string {
  return `parameters:
    level: ${PHPSTAN_LEVEL}
    bootstrapFiles:
        - vendor/autoload.php
    paths:
        - src
        - tests
${app ? '        - bin\n' : ''}`
}

/**
 * The files of a PHP project's worked example, as paths relative to the project to contents.
 *
 * @remarks
 * The PHP mapping of the vertical-slice rules: PSR-4 needs a class file named for its class, so the role is in the class
 * name (`GreetUseCase.php`, `GreetingContract.php`, as for C# and Java) and the folder and namespace `Greeting` are the
 * slice. An app's `bin/<name>.php` only wires.
 *
 * @param kind - Which PHP kind.
 * @param vendor - The Composer vendor.
 * @param name - The project name, which an app greets.
 * @returns The files to write.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function phpExampleFiles (kind: PhpKind, vendor: string, name: string): Record<string, string> {
  const namespace = phpNamespace(vendor, name)
  const files: Record<string, string> = {
    'src/Greeting/GreetingContract.php': String.raw`<?php

declare(strict_types=1);

namespace ${namespace}\Greeting;

/** What greeting someone returns. */
final readonly class GreetingContract
{
    public function __construct(public string $message)
    {
    }
}
`,
    'src/Greeting/GreetUseCase.php': String.raw`<?php

declare(strict_types=1);

namespace ${namespace}\Greeting;

/** Greets a name; a blank one is greeted as a stranger. */
final class GreetUseCase
{
    public static function greet(string $name): GreetingContract
    {
        $who = trim($name) === '' ? 'stranger' : trim($name);

        return new GreetingContract('Hello, ' . $who . '!');
    }
}
`,
    'tests/Greeting/GreetUseCaseTest.php': String.raw`<?php

declare(strict_types=1);

namespace ${namespace}\Tests\Greeting;

use ${namespace}\Greeting\GreetUseCase;
use PHPUnit\Framework\TestCase;

final class GreetUseCaseTest extends TestCase
{
    public function testGreetsAName(): void
    {
        $this->assertSame('Hello, Ada!', GreetUseCase::greet('Ada')->message);
    }

    public function testGreetsABlankNameAsAStranger(): void
    {
        $this->assertSame('Hello, stranger!', GreetUseCase::greet('   ')->message);
    }
}
`,
  }
  if (kind === 'php-app') {
    files[`bin/${name}.php`] = String.raw`<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use ${namespace}\Greeting\GreetUseCase;

echo GreetUseCase::greet('${name}')->message . "\n";
`
  }

  return files
}

/**
 * What `mnci add php-app|php-lib --empty` writes: an entry script that does nothing, and a test that proves the setup.
 *
 * @remarks
 * PHPUnit exits non-zero on an empty suite, as pytest does, so a bare project keeps one test that only asserts the
 * autoloader loads. A directory the tools are pointed at must exist, so `src/` is kept with a `.gitkeep`.
 *
 * @param kind - Which PHP kind.
 * @param vendor - The Composer vendor.
 * @param name - The project name.
 * @returns The files to write.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function phpEmptyFiles (kind: PhpKind, vendor: string, name: string): Record<string, string> {
  const namespace = phpNamespace(vendor, name)
  const files: Record<string, string> = {
    'src/.gitkeep':        '',
    'tests/SmokeTest.php': String.raw`<?php

declare(strict_types=1);

namespace ${namespace}\Tests;

use PHPUnit\Framework\TestCase;

final class SmokeTest extends TestCase
{
    public function testTheAutoloaderLoads(): void
    {
        $this->assertTrue(class_exists(TestCase::class));
    }
}
`,
  }
  if (kind === 'php-app') {
    files[`bin/${name}.php`] = '<?php\n\ndeclare(strict_types=1);\n'
  }

  return files
}
