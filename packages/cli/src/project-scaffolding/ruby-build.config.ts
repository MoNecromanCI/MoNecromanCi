/**
 * The Ruby version every project requires (`required_ruby_version`, and RuboCop's `TargetRubyVersion`).
 *
 * @remarks
 * A floor, not a pin. Ruby 3.3 is the oldest still receiving security fixes the example needs nothing newer than; the hosted
 * CI images and `ruby/setup-ruby` carry 3.3, 3.4 and 3.5.
 */
export const RUBY_MIN_VERSION = '3.3'

/**
 * The RuboCop constraint in the workspace root's `Gemfile`.
 *
 * @remarks
 * RuboCop is the one dev tool shared at the root: it reads source files and needs none of a project's gems. RSpec is not
 * shared. Bundler loads one bundle per process, so a spec run must load the project's own gems and RSpec with them, which
 * puts `rspec` in each project's `Gemfile` (`group :test`).
 */
export const RUBOCOP_CONSTRAINT = '~> 1.80'

/**
 * The RSpec constraint in every project's `Gemfile`.
 *
 * @remarks
 * In the `test` group, so `bundle exec rspec` loads a project's gems and the runner in one bundle.
 */
export const RSPEC_CONSTRAINT = '~> 3.13'

/**
 * The workspace's `.rubocop.yml`: new cops on, the end-of-line cop off, and spec blocks left long.
 *
 * @remarks
 * `Layout/EndOfLine` is Git's job (`autocrlf`): on Windows it demands CRLF of files mnci wrote with LF, and a team on LF
 * would be told the opposite. Documentation comments are required of nothing: the example documents its modules and a
 * project that wants the cop turns it on. Written once and then the team's.
 */
export const RUBOCOP_CONFIG = `# Written by MoNecromanCI; yours from here on.
AllCops:
  NewCops: enable
  SuggestExtensions: false
  TargetRubyVersion: ${RUBY_MIN_VERSION}

Layout/EndOfLine:
  Enabled: false

Metrics/BlockLength:
  Exclude:
    - '**/spec/**/*'
`
