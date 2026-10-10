import { functionAppLocalSettings } from './function-app-local-settings.algorithm'

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
 * What `mnci add go-app --empty` writes: a `main.go` that does nothing yet.
 *
 * @remarks
 * No `hello` package and no test; the app builds and runs as it is (#330). `go test ./...` reports no test files and passes.
 *
 * @param None - this function takes no parameters.
 * @returns The files to write, keyed by path relative to the app.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function goAppEmptyFiles (): Record<string, string> {
  return {
    'main.go': ['package main', '', 'func main() {}', ''].join('\n'),
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

/**
 * The `host.json` of a Go function app: Azure Functions' custom handler model.
 *
 * @remarks
 * A Go function app is not a language worker: the host starts the compiled `handler` and forwards each HTTP request to it
 * (`enableForwardingHttpRequest`). The executable has one name on every OS (measured on Windows: an extensionless `handler`
 * starts, so `handler.exe` is not needed), which is what lets `go build -o handler .` serve `func start` everywhere.
 */
export const GO_FUNCTION_APP_HOST_JSON = JSON.stringify({
  version:         '2.0',
  extensionBundle: { id: 'Microsoft.Azure.Functions.ExtensionBundle', version: '[4.*, 5.0.0)' },
  customHandler:   {
    description:                 { defaultExecutablePath: 'handler' },
    enableForwardingHttpRequest: true,
  },
}, null, 2) + '\n'

/**
 * The `function.json` of the example function: an anonymous HTTP GET at `/api/hello`.
 *
 * @remarks
 * The folder it sits in names the function, and the route defaults to that name, so the handler's `/api/hello` is the same
 * string.
 */
export const GO_FUNCTION_APP_HELLO_FUNCTION_JSON = JSON.stringify({
  bindings: [
    { authLevel: 'anonymous', type: 'httpTrigger', direction: 'in', name: 'req', methods: ['get'] },
    { type: 'http', direction: 'out', name: 'res' },
  ],
}, null, 2) + '\n'

/**
 * The files a Go function app holds besides its Go code: the host config, the local settings and what keeps the build out of git.
 *
 * @remarks
 * `handler` is what `start` builds into the app directory. `local.settings.json` carries `FUNCTIONS_WORKER_RUNTIME: custom`,
 * without which `func start` cannot tell what the folder is (measured: "Worker runtime cannot be 'None'"); it holds no secret,
 * so it is committed rather than ignored.
 */
export const GO_FUNCTION_APP_HOST_FILES: Record<string, string> = {
  'host.json':           GO_FUNCTION_APP_HOST_JSON,
  'local.settings.json': functionAppLocalSettings('custom'),
  '.gitignore':          ['handler', 'handler.exe', ''].join('\n'),
}

/**
 * The server `main.go` of a Go function app, with the routes it registers.
 *
 * @param imports - Extra import lines (already tab-indented, a blank line separating them from the standard library).
 * @param routes - The `mux.HandleFunc` statements, tab-indented.
 * @returns The file contents.
 * @throws Never - pure string construction.
 * @typeParam None - this function has no generic type parameters.
 */
function goFunctionAppMain (imports: string[], routes: string[]): string {
  return [
    'package main',
    '',
    'import (',
    ...imports,
    ')',
    '',
    'func main() {',
    '\tport := os.Getenv("FUNCTIONS_CUSTOMHANDLER_PORT")',
    '\tif port == "" {',
    '\t\tport = "8080"',
    '\t}',
    '\tmux := http.NewServeMux()',
    ...routes,
    '\tserver := &http.Server{Addr: ":" + port, Handler: mux, ReadHeaderTimeout: 10 * time.Second}',
    '\tlog.Fatal(server.ListenAndServe())',
    '}',
    '',
  ].join('\n')
}

/**
 * What `mnci add go-function-app --empty` writes: the host config and a server with no route yet.
 *
 * @remarks
 * `start` runs it as it is; a function is a folder with a `function.json` and a route in `main.go`.
 *
 * @param None - this function takes no parameters.
 * @returns The files to write, keyed by path relative to the app.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function goFunctionAppEmptyFiles (): Record<string, string> {
  return {
    ...GO_FUNCTION_APP_HOST_FILES,
    'main.go': goFunctionAppMain(['\t"log"', '\t"net/http"', '\t"os"', '\t"time"'], []),
  }
}

/**
 * The worked example for a Go function app: the `hello` slice, served at `/api/hello` by the custom handler.
 *
 * @remarks
 * `main.go` only wires, as in an app: it routes the request to the use case. `hello/function.json` is what tells the host
 * the function exists.
 *
 * @param modulePath - The app's Go module path, which `main.go` imports the slice through.
 * @returns The files to write, keyed by path relative to the app.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function goFunctionAppExampleFiles (modulePath: string): Record<string, string> {
  return {
    ...GO_FUNCTION_APP_HOST_FILES,
    'main.go': goFunctionAppMain(
      ['\t"fmt"', '\t"log"', '\t"net/http"', '\t"os"', '\t"time"', '', `\t"${modulePath}/hello"`],
      [
        '\tmux.HandleFunc("/api/hello", func(w http.ResponseWriter, r *http.Request) {',
        '\t\tname := r.URL.Query().Get("name")',
        '\t\tif name == "" {',
        '\t\t\tname = "world"',
        '\t\t}',
        '\t\t_, _ = fmt.Fprint(w, hello.Greet(name).Message)',
        '\t})',
      ],
    ),
    'hello/function.json':          GO_FUNCTION_APP_HELLO_FUNCTION_JSON,
    'hello/greeting_contract.go':   greetingContract('hello'),
    'hello/greet_use_case.go':      greetUseCase('hello'),
    'hello/greet_use_case_test.go': greetUseCaseTest('hello'),
  }
}
