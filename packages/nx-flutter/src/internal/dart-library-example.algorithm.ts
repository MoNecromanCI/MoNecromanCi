/**
 * The worked example `flutter-lib` and `flutter-internal-lib` write over `flutter create`'s
 * `Calculator`, as paths under the project to contents.
 *
 * @remarks
 * The Dart mapping of the vertical-slice rules: a slice folder under `lib/src/` named
 * for the package, holding `greeting_contract.dart` (the data a call returns) and
 * `greet_use_case.dart` (one outcome) behind a slice barrel `<package>.dart`, which the
 * package's own `lib/<package>.dart` re-exports. Its test is mirrored under `test/` as
 * `<basename>_test.dart`. Dart interpolates with `$name`, which is not a template
 * placeholder here, so the text needs no escaping.
 *
 * @param packageName - The Dart-safe package name (see `dartPackageName`).
 * @returns The files to write, keyed by path relative to the project root.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function dartLibraryExampleFiles (packageName: string): Record<string, string> {
  return {
    [`lib/${packageName}.dart`]: `export 'src/${packageName}/${packageName}.dart';
`,
    [`lib/src/${packageName}/${packageName}.dart`]: `export 'greet_use_case.dart';
export 'greeting_contract.dart';
`,
    [`lib/src/${packageName}/greeting_contract.dart`]: `/// What greeting someone returns.
class Greeting {
  const Greeting(this.message);

  final String message;
}
`,
    [`lib/src/${packageName}/greet_use_case.dart`]: `import 'greeting_contract.dart';

/// Greets someone by name: a worked example of a use case. Replace it with your own.
Greeting greet(String name) => Greeting('Hello, $name!');
`,
    [`test/src/${packageName}/greet_use_case_test.dart`]: `import 'package:${packageName}/${packageName}.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('greets a name', () {
    expect(greet('world').message, 'Hello, world!');
  });
}
`,
  }
}

/**
 * The placeholder files `flutter create --template package` writes, which the example replaces.
 *
 * @remarks
 * The package barrel and the test are rewritten in place, so only the old test needs
 * removing.
 *
 * @param packageName - The Dart-safe package name.
 * @returns Paths relative to the project root.
 * @throws Never - pure array construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function dartLibraryPlaceholderFiles (packageName: string): string[] {
  return [`test/${packageName}_test.dart`]
}
