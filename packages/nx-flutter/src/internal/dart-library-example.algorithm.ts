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
 * What a Dart library scaffolded with `--empty` holds: the slice folder, a barrel with nothing exported, and one test.
 *
 * @remarks
 * The barrel exists so the first export is a one-line change. The test does not import the package (an unused import is
 * an `info`, which `flutter analyze --fatal-infos` fails), and it is there because `flutter test` exits non-zero when it
 * finds none.
 *
 * @param packageName - The Dart-safe package name.
 * @returns The files to write, keyed by path relative to the project root.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function dartLibraryEmptyFiles (packageName: string): Record<string, string> {
  return {
    [`lib/${packageName}.dart`]: `export 'src/${packageName}/${packageName}.dart';
`,
    [`lib/src/${packageName}/${packageName}.dart`]: `// Declare this slice's public names here.
`,
    [`test/src/${packageName}/${packageName}_test.dart`]: `import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the package is testable', () {
    expect(1 + 1, 2);
  });
}
`,
  }
}

/**
 * What a Flutter app scaffolded with `--empty` holds in place of `flutter create`'s counter sample.
 *
 * @remarks
 * An entry point that shows nothing, and one smoke test (the counter's widget test is removed with its sample).
 *
 * @param None - this function takes no parameters.
 * @returns The files to write, keyed by path relative to the project root.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function dartAppEmptyFiles (): Record<string, string> {
  return {
    'lib/main.dart': `import 'package:flutter/widgets.dart';

void main() {
  runApp(const SizedBox.shrink());
}
`,
    'test/main_test.dart': `import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the project is testable', () {
    expect(1 + 1, 2);
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
