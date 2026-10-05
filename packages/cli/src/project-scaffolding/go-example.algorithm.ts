/**
 * The contract of the Go worked example: the data a greeting call returns.
 *
 * @param packageName - The Go package the file belongs to.
 * @returns The Go source.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
function greetingContract (packageName: string): string {
  return [
    `package ${packageName}`,
    '',
    '// Greeting is what greeting someone returns.',
    'type Greeting struct {',
    '\tMessage string',
    '}',
    '',
  ].join('\n')
}

/**
 * The use case of the Go worked example: one outcome, returning the contract.
 *
 * @param packageName - The Go package the file belongs to.
 * @returns The Go source.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
function greetUseCase (packageName: string): string {
  return [
    `package ${packageName}`,
    '',
    '// Greet greets someone by name: a worked example of a use case. Replace it with your own.',
    'func Greet(name string) Greeting {',
    '\treturn Greeting{Message: "Hello, " + name + "!"}',
    '}',
    '',
  ].join('\n')
}

/**
 * The use case's test.
 *
 * @param packageName - The Go package the file belongs to.
 * @returns The Go source.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
function greetUseCaseTest (packageName: string): string {
  return [
    `package ${packageName}`,
    '',
    'import "testing"',
    '',
    'func TestGreet(t *testing.T) {',
    '\tif got := Greet("world").Message; got != "Hello, world!" {',
    '\t\tt.Fatalf("got %q", got)',
    '\t}',
    '}',
    '',
  ].join('\n')
}

/**
 * The worked example for a Go library's starter slice, as file names to contents.
 *
 * @remarks
 * The Go mapping of the vertical-slice rules: one package per outcome, snake_case files
 * ending in their role, the test beside the file it tests. The use case keeps the
 * `<stem>_use_case.go` name the generator's sample had, so anything keyed on that path
 * (Nx's `affected` checks) is undisturbed.
 *
 * @param packageName - The slice's Go package name.
 * @param fileStem - The snake_case stem the use case's file is named after.
 * @returns The files to write inside the slice package, keyed by file name.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function goLibraryExampleFiles (packageName: string, fileStem: string): Record<string, string> {
  return {
    'greeting_contract.go':           greetingContract(packageName),
    [`${fileStem}_use_case.go`]:      greetUseCase(packageName),
    [`${fileStem}_use_case_test.go`]: greetUseCaseTest(packageName),
  }
}

/**
 * The worked example for a Go app, as paths under the app's directory to contents.
 *
 * @remarks
 * `main.go` stays the entry point and only wires: it calls the use case of a `hello`
 * package, whose files are the contract, the use case and its test. The generator's
 * root `Hello` function and its test are replaced.
 *
 * @param modulePath - The app's Go module path, which `main.go` imports the slice through.
 * @returns The files to write, keyed by path relative to the app.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function goAppExampleFiles (modulePath: string): Record<string, string> {
  return {
    'main.go': [
      'package main',
      '',
      'import (',
      '\t"fmt"',
      '',
      `\t"${modulePath}/hello"`,
      ')',
      '',
      'func main() {',
      '\tfmt.Println(hello.Greet("world").Message)',
      '}',
      '',
    ].join('\n'),
    'hello/greeting_contract.go':   greetingContract('hello'),
    'hello/greet_use_case.go':      greetUseCase('hello'),
    'hello/greet_use_case_test.go': greetUseCaseTest('hello'),
  }
}
