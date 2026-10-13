import { cppIdentifier, VCPKG_TOOLCHAIN_HOOK } from '../dependency-management'

/**
 * The three C++ project kinds.
 *
 * @remarks
 * They differ in where they live and whether they build an executable.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type CppKind = 'cpp-app' | 'cpp-lib' | 'cpp-internal-lib'

/**
 * The `CMakeLists.txt` of a C++ project.
 *
 * @remarks
 * Each project configures and builds on its own, into its own `dist/cmake/<name>` (Nx clears a target's outputs when it
 * restores them from cache, so a directory shared by every project would delete the others' artifacts). A library
 * consumed by another project is added with `add_subdirectory` from that project's own `CMakeLists.txt`.
 *
 * Warnings are errors for every compiler (`-Wall -Wextra -Wpedantic -Werror`, `/W4 /WX` on MSVC): the compiler is the first
 * linter, and `cppcheck` the second. The tests are one executable with no framework, registered with CTest, so a project
 * builds and tests with CMake alone; a test framework arrives with the package manager, as every dependency does.
 *
 * @param kind - Which C++ kind.
 * @param name - The project name.
 * @param empty - Whether the project is bare: no example, no test.
 * @returns The text of `CMakeLists.txt`.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function cppCmakeLists (kind: CppKind, name: string, empty: boolean): string {
  const id = cppIdentifier(name)
  const app = kind === 'cpp-app'
  const sources = empty ? [] : [`src/${id}/greeting/greet_use_case.cpp`]
  const lines = [
    'cmake_minimum_required(VERSION 3.20)',
    // vcpkg's toolchain when VCPKG_ROOT is set, so `mnci install -w <project> <port>` resolves on any machine that has it.
    ...VCPKG_TOOLCHAIN_HOOK,
    `project(${name} VERSION 0.1.0 LANGUAGES CXX)`,
    '',
    'set(CMAKE_CXX_STANDARD 20)',
    'set(CMAKE_CXX_STANDARD_REQUIRED ON)',
    'set(CMAKE_CXX_EXTENSIONS OFF)',
    '',
    'function(mnci_warnings target)',
    '  if(MSVC)',
    '    target_compile_options(${target} PRIVATE /W4 /WX)',
    '  else()',
    '    target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic -Werror)',
    '  endif()',
    'endfunction()',
    '',
  ]
  if (app) {
    lines.push(
      `add_executable(${id} ${['src/main.cpp', ...sources].join(' ')})`,
      `target_include_directories(${id} PRIVATE src)`,
      `set_target_properties(${id} PROPERTIES OUTPUT_NAME ${name})`,
      `mnci_warnings(${id})`,
    )
  } else {
    lines.push(
      sources.length > 0 ? `add_library(${id} STATIC ${sources.join(' ')})` : `add_library(${id} INTERFACE)`,
      `target_include_directories(${id} ${sources.length > 0 ? 'PUBLIC' : 'INTERFACE'} src)`,
    )
    if (sources.length > 0) {
      lines.push(`mnci_warnings(${id})`)
    }
  }
  if (!empty) {
    lines.push(
      '',
      'enable_testing()',
      `add_executable(${id}_tests src/${id}/greeting/greet_use_case_test.cpp ${sources.join(' ')})`,
      `target_include_directories(${id}_tests PRIVATE src)`,
      `mnci_warnings(${id}_tests)`,
      `add_test(NAME ${id}_tests COMMAND ${id}_tests)`,
    )
  }

  return `${lines.join('\n')}\n`
}

/**
 * The source files of a C++ project's worked example, as paths relative to the project to contents.
 *
 * @remarks
 * The C++ mapping of the vertical-slice rules: a slice is a folder under `src/<project>/`, files are `snake_case` and carry
 * their role (`greeting_contract.hpp`, `greet_use_case.cpp`), the slice's own header (`greeting.hpp`) is its barrel, and
 * `main.cpp` only wires. The test sits beside what it tests and needs no framework: a function that returns non-zero
 * when a check fails, which CTest reads.
 *
 * @param kind - Which C++ kind.
 * @param name - The project name, which an app greets.
 * @returns The files to write.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function cppExampleFiles (kind: CppKind, name: string): Record<string, string> {
  const id = cppIdentifier(name)
  const base = `src/${id}/greeting`
  const files: Record<string, string> = {
    [`${base}/greeting_contract.hpp`]: [
      '#pragma once',
      '',
      '#include <string>',
      '',
      `namespace ${id}::greeting {`,
      '',
      '/// What greeting someone returns.',
      'struct Greeting {',
      '    std::string message;',
      '};',
      '',
      `}  // namespace ${id}::greeting`,
      '',
    ].join('\n'),
    [`${base}/greet_use_case.hpp`]: [
      '#pragma once',
      '',
      '#include <string>',
      '',
      `#include "${id}/greeting/greeting_contract.hpp"`,
      '',
      `namespace ${id}::greeting {`,
      '',
      '/// Greets a name; a blank one is greeted as a stranger.',
      'Greeting greet(const std::string& name);',
      '',
      `}  // namespace ${id}::greeting`,
      '',
    ].join('\n'),
    [`${base}/greet_use_case.cpp`]: [
      `#include "${id}/greeting/greet_use_case.hpp"`,
      '',
      `namespace ${id}::greeting {`,
      '',
      'Greeting greet(const std::string& name) {',
      String.raw`    const auto first = name.find_first_not_of(" \t\n");`,
      String.raw`    const auto last = name.find_last_not_of(" \t\n");`,
      '    const bool blank = first == std::string::npos;',
      '    const std::string who = blank ? "stranger" : name.substr(first, last - first + 1);',
      '',
      '    return Greeting{"Hello, " + who + "!"};',
      '}',
      '',
      `}  // namespace ${id}::greeting`,
      '',
    ].join('\n'),
    [`${base}/greeting.hpp`]: [
      '#pragma once',
      '',
      `#include "${id}/greeting/greet_use_case.hpp"`,
      `#include "${id}/greeting/greeting_contract.hpp"`,
      '',
    ].join('\n'),
    [`${base}/greet_use_case_test.cpp`]: [
      '#include <iostream>',
      '',
      `#include "${id}/greeting/greeting.hpp"`,
      '',
      'namespace {',
      '',
      'int failures = 0;',
      '',
      'void check(bool condition, const char* what) {',
      '    if (!condition) {',
      String.raw`        std::cerr << "FAILED: " << what << "\n";`,
      '        ++failures;',
      '    }',
      '}',
      '',
      '}  // namespace',
      '',
      'int main() {',
      `    check(${id}::greeting::greet("Ada").message == "Hello, Ada!", "greets a name");`,
      `    check(${id}::greeting::greet("   ").message == "Hello, stranger!", "greets a blank name as a stranger");`,
      '',
      '    return failures == 0 ? 0 : 1;',
      '}',
      '',
    ].join('\n'),
  }
  if (kind === 'cpp-app') {
    files['src/main.cpp'] = [
      '#include <iostream>',
      '',
      `#include "${id}/greeting/greeting.hpp"`,
      '',
      'int main() {',
      String.raw`    std::cout << ${id}::greeting::greet("${name}").message << "\n";`,
      '',
      '    return 0;',
      '}',
      '',
    ].join('\n')
  }

  return files
}

/**
 * What `mnci add cpp-app|cpp-lib --empty` writes: an entry point that does nothing, or no source at all.
 *
 * @remarks
 * A library has no source file (an interface library over `src/`), as a bare C# class library has none; the first slice
 * is the first folder you add (#330). There is no test, so `ctest` finds none and the `test` target passes.
 *
 * @param kind - Which C++ kind.
 * @returns The files to write.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function cppEmptyFiles (kind: CppKind): Record<string, string> {
  return kind === 'cpp-app'
    ? { 'src/main.cpp': 'int main() { return 0; }\n' }
    : {}
}
