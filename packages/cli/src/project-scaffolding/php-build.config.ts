/**
 * The PHP version every project requires (`require.php`).
 *
 * @remarks
 * A floor, not a pin: `readonly` classes and typed class constants, which the example uses, are PHP 8.3. The hosted CI
 * images and `shivammathur/setup-php` carry 8.3, 8.4 and 8.5.
 */
export const PHP_MIN_VERSION = '8.3'

/**
 * The shared PHP dev tools, as `composer require-dev` constraints in the workspace root's `composer.json`.
 *
 * @remarks
 * Dev tools are the one dependency kind the per-project rule lets live at the root: every project is tested and linted by the
 * same PHPUnit, PHPStan and PHP_CodeSniffer, installed once. A project's runtime dependencies stay in its own `composer.json`
 * and its own `vendor/`.
 */
export const PHP_DEV_TOOLS: Readonly<Record<string, string>> = {
  'phpunit/phpunit':           '^12.0',
  'phpstan/phpstan':           '^2.1',
  'squizlabs/php_codesniffer': '^4.0',
}

/**
 * The PHPStan level every project is analysed at.
 *
 * @remarks
 * 8 is one below `max`: it checks every type and nullability rule, and leaves out only the strictness about `mixed`.
 */
export const PHPSTAN_LEVEL = 8

/**
 * Where the shared dev tools' executables are installed, relative to the workspace root.
 *
 * @remarks
 * Composer's default `vendor-dir` of the root `composer.json`, which lists only dev tools.
 */
export const PHP_TOOLS_BIN = 'vendor/bin'
