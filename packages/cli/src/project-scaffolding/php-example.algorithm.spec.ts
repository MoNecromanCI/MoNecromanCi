import {
  phpEmptyFiles,
  phpExampleFiles,
  phpNamespace,
  phpProjectComposerJson,
  phpRootComposerJson,
  phpStanConfig,
  phpStudly,
  phpVendor,
} from './php-example.algorithm'

describe('phpVendor', () => {
  it('is the lowercase organisation of the origin, and app without one', () => {
    expect(phpVendor('github.com/MoNecromanCI/mnci')).toBe('monecromanci')
    expect(phpVendor('github.com/Acme Corp/x')).toBe('acme-corp')
    expect(phpVendor(undefined)).toBe('app')
  })
})

describe('phpStudly and phpNamespace', () => {
  it('joins the words of a name, and keeps a leading digit legal', () => {
    expect(phpStudly('my-tool_2')).toBe('MyTool2')
    expect(phpStudly('3d-kit')).toBe('_3dKit')
    expect(phpNamespace('acme-corp', 'my-tool')).toBe(String.raw`AcmeCorp\MyTool`)
  })
})

describe('composer.json', () => {
  it('maps the namespace to src/ and its Tests to tests/, in four-space JSON', () => {
    const text = phpProjectComposerJson('php-app', 'acme', 'hello')
    const manifest = JSON.parse(text)

    expect(manifest.autoload['psr-4']).toEqual({ 'Acme\\Hello\\': 'src/' })
    expect(manifest['autoload-dev']['psr-4']).toEqual({ 'Acme\\Hello\\Tests\\': 'tests/' })
    expect(manifest.require.php).toBe('>=8.3')
    expect(text).toContain('\n    "name"')
  })

  it('the root one holds dev tools only', () => {
    const manifest = JSON.parse(phpRootComposerJson('acme'))

    expect(manifest.require).toBeUndefined()
    expect(manifest['require-dev']['phpunit/phpunit']).toBeDefined()
  })
})

describe('the worked example', () => {
  it('puts the slice in a StudlyCase folder with the role in the class name', () => {
    const files = phpExampleFiles('php-lib', 'acme', 'kit')

    expect(Object.keys(files)).toEqual([
      'src/Greeting/GreetingContract.php',
      'src/Greeting/GreetUseCase.php',
      'tests/Greeting/GreetUseCaseTest.php',
    ])
    expect(files['src/Greeting/GreetUseCase.php']).toContain(String.raw`namespace Acme\Kit\Greeting;`)
    expect(files['src/Greeting/GreetUseCase.php']).toContain('declare(strict_types=1);')
  })

  it('gives an app a bin script that only wires, and analyses bin/ in PHPStan', () => {
    const files = phpExampleFiles('php-app', 'acme', 'hello')

    expect(files['bin/hello.php']).toContain("GreetUseCase::greet('hello')")
    expect(phpStanConfig(true)).toContain('- bin')
    expect(phpStanConfig(false)).not.toContain('- bin')
  })

  it('a bare project keeps a smoke test and a src folder', () => {
    expect(Object.keys(phpEmptyFiles('php-lib', 'acme', 'kit'))).toEqual(['src/.gitkeep', 'tests/SmokeTest.php'])
    expect(Object.keys(phpEmptyFiles('php-app', 'acme', 'hello'))).toContain('bin/hello.php')
  })
})
