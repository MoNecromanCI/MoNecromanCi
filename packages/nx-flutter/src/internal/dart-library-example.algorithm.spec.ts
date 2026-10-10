import { dartAppEmptyFiles, dartLibraryEmptyFiles, dartLibraryExampleFiles, dartLibraryPlaceholderFiles } from './dart-library-example.algorithm'

describe('dartLibraryExampleFiles', () => {
  const files = dartLibraryExampleFiles('core')

  it('writes a slice under lib/src with a contract, a use case and a barrel, re-exported by the package', () => {
    expect(Object.keys(files).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'lib/core.dart',
      'lib/src/core/core.dart',
      'lib/src/core/greet_use_case.dart',
      'lib/src/core/greeting_contract.dart',
      'test/src/core/greet_use_case_test.dart',
    ])
    expect(files['lib/core.dart']).toContain("export 'src/core/core.dart';")
    expect(files['lib/src/core/core.dart']).toContain("export 'greet_use_case.dart';")
    expect(files['lib/src/core/core.dart']).toContain("export 'greeting_contract.dart';")
  })

  it('tests the use case through the package barrel, as a consumer would', () => {
    expect(files['test/src/core/greet_use_case_test.dart']).toContain("import 'package:core/core.dart';")
    expect(files['test/src/core/greet_use_case_test.dart']).toContain("expect(greet('world').message, 'Hello, world!');")
  })

  it('replaces the placeholder test flutter create writes', () => {
    expect(dartLibraryPlaceholderFiles('core')).toEqual(['test/core_test.dart'])
  })
})

describe('dartLibraryEmptyFiles', () => {
  const files = dartLibraryEmptyFiles('core')

  it('keeps the slice folder and its barrel with nothing exported, and one test', () => {
    expect(Object.keys(files).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'lib/core.dart',
      'lib/src/core/core.dart',
      'test/src/core/core_test.dart',
    ])
    expect(files['lib/src/core/core.dart']).not.toContain('export')
  })

  it('has a test that imports nothing, so the analyser has no unused import to report', () => {
    expect(files['test/src/core/core_test.dart']).not.toContain("import 'package:core")
  })
})

describe('dartAppEmptyFiles', () => {
  it('replaces the counter sample with an entry point that shows nothing, and one test', () => {
    const files = dartAppEmptyFiles()

    expect(Object.keys(files).toSorted((a, b) => a.localeCompare(b))).toEqual(['lib/main.dart', 'test/main_test.dart'])
    expect(files['lib/main.dart']).toContain('SizedBox.shrink()')
  })
})
