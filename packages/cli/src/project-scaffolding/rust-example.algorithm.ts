/**
 * The source files of a Rust project's worked example, as paths under `src/` to contents.
 *
 * @remarks
 * The Rust mapping of the vertical-slice rules (the global rules' language table): a slice is a module folder whose
 * `mod.rs` is its barrel, files are `snake_case` and carry their role (`greeting_contract.rs`, `greet_use_case.rs`), and
 * the root file (`main.rs` or `lib.rs`) only wires. A unit test sits in the file it tests, in the
 * `#[cfg(test)] mod tests` Rust itself expects, which is "beside what it tests".
 *
 * An app prints the greeting; a library re-exports the slice's public names. The text has no template literal, so it
 * needs no escaping.
 *
 * @param kind - Whether the project is a binary (`app`) or a library.
 * @param name - The project name, which an app greets.
 * @returns The files to write, keyed by path under `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function rustExampleFiles (kind: 'app' | 'lib', name: string): Record<string, string> {
  const slice: Record<string, string> = {
    'greeting/mod.rs': [
      'mod greet_use_case;',
      'mod greeting_contract;',
      '',
      'pub use greet_use_case::greet;',
      'pub use greeting_contract::Greeting;',
      '',
    ].join('\n'),
    'greeting/greeting_contract.rs': [
      '/// What greeting someone returns.',
      '#[derive(Debug, Clone, PartialEq, Eq)]',
      'pub struct Greeting {',
      '    pub message: String,',
      '}',
      '',
    ].join('\n'),
    'greeting/greet_use_case.rs': [
      'use super::greeting_contract::Greeting;',
      '',
      '/// Greets a name; a blank one is greeted as a stranger.',
      'pub fn greet(name: &str) -> Greeting {',
      '    let trimmed = name.trim();',
      '    let who = if trimmed.is_empty() {',
      '        "stranger"',
      '    } else {',
      '        trimmed',
      '    };',
      '',
      '    Greeting {',
      '        message: format!("Hello, {who}!"),',
      '    }',
      '}',
      '',
      '#[cfg(test)]',
      'mod tests {',
      '    use super::*;',
      '',
      '    #[test]',
      '    fn greets_a_name() {',
      '        assert_eq!(greet("Ada").message, "Hello, Ada!");',
      '    }',
      '',
      '    #[test]',
      '    fn greets_a_blank_name_as_a_stranger() {',
      '        assert_eq!(greet("   ").message, "Hello, stranger!");',
      '    }',
      '}',
      '',
    ].join('\n'),
  }
  if (kind === 'lib') {
    return {
      ...slice,
      'lib.rs': [
        'mod greeting;',
        '',
        'pub use greeting::{greet, Greeting};',
        '',
      ].join('\n'),
    }
  }

  return {
    ...slice,
    'main.rs': [
      'mod greeting;',
      '',
      'use greeting::Greeting;',
      '',
      'fn main() {',
      `    let greeting: Greeting = greeting::greet("${name}");`,
      '    println!("{}", greeting.message);',
      '}',
      '',
    ].join('\n'),
  }
}

/**
 * What `mnci add rust-app|rust-lib --empty` writes: an entry point that does nothing.
 *
 * @remarks
 * `cargo test` passes with no tests, so no smoke test is needed (unlike Python's pytest, which exits 5). A library keeps
 * an empty `lib.rs`; the first slice is the first folder you add (#330).
 *
 * @param kind - Whether the project is a binary (`app`) or a library.
 * @returns The files to write, keyed by path under `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function rustEmptyFiles (kind: 'app' | 'lib'): Record<string, string> {
  return kind === 'lib'
    ? { 'lib.rs': '' }
    : { 'main.rs': 'fn main() {}\n' }
}
