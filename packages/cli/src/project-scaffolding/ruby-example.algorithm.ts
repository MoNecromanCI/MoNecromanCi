import { RSPEC_CONSTRAINT, RUBOCOP_CONSTRAINT, RUBY_MIN_VERSION } from './ruby-build.config'

/**
 * The three Ruby project kinds.
 *
 * @remarks
 * They differ in where they live and whether they have an entry script. A library of either kind is a gem (it has a
 * gemspec, which Bundler needs to take it as a `path:` source); an app is a Bundler project with a `Gemfile` and a `bin/`.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type RubyKind = 'ruby-app' | 'ruby-lib' | 'ruby-internal-lib'

/**
 * The file and folder name of a project under `lib/`: its name in snake_case.
 *
 * @remarks
 * Ruby's own convention: `my-tool` is required as `my_tool` and its constant is `MyTool`.
 *
 * @param name - The project name.
 * @returns The name with every run of characters that is not a letter or digit as one underscore, lowercased, prefixed with
 * `_` when it would start with a digit.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function rubySnake (name: string): string {
  const snake = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_').replaceAll(/^_+|_+$/g, '')

  return /^\d/.test(snake) ? `_${snake}` : snake
}

/**
 * The constant a project's code lives in: its name in CamelCase.
 *
 * @remarks
 * A name that would start with a digit is prefixed with `M`, since a constant cannot.
 *
 * @param name - The project name.
 * @returns The words of the name capitalised and joined (`my-tool` is `MyTool`).
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function rubyModule (name: string): string {
  const camel = rubySnake(name)
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')

  return /^\d/.test(camel) ? `M${camel}` : camel
}

/**
 * The workspace root's `Gemfile`: the shared dev tools.
 *
 * @remarks
 * RuboCop only; see {@link RUBOCOP_CONSTRAINT} for why RSpec is a project's own.
 *
 * @param rubocop - The RuboCop version constraint.
 * @returns The text of `Gemfile`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function rubyRootGemfile (rubocop: string = RUBOCOP_CONSTRAINT): string {
  return `# frozen_string_literal: true

# Shared Ruby dev tools for this workspace (written by MoNecromanCI). A project's own gems are in its own Gemfile.
source 'https://rubygems.org'

group :development do
  gem 'rubocop', '${rubocop}'
end
`
}

/**
 * A project's `Gemfile`.
 *
 * @remarks
 * A library lists itself through its gemspec; an app lists only what it uses. `rspec` is in the `test` group so
 * `bundle exec rspec` loads the project's gems and the runner in one bundle.
 *
 * @param kind - Which Ruby kind.
 * @returns The text of `Gemfile`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function rubyProjectGemfile (kind: RubyKind): string {
  return `# frozen_string_literal: true

source 'https://rubygems.org'
${kind === 'ruby-app' ? '' : '\ngemspec\n'}
group :test do
  gem 'rspec', '${RSPEC_CONSTRAINT}'
end
`
}

/**
 * A library's `<name>.gemspec`.
 *
 * @remarks
 * The version comes from `lib/<snake>/version.rb`, which `nx release` reads and writes (`bundle gem`'s own convention),
 * and `rubygems_mfa_required` is on because RuboCop's `Gemspec/RequireMFA` asks for it of a gem that may be published.
 *
 * @param name - The project name, which is the gem name.
 * @returns The text of the gemspec.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function rubyGemspec (name: string): string {
  const snake = rubySnake(name)

  return `# frozen_string_literal: true

require_relative 'lib/${snake}/version'

Gem::Specification.new do |spec|
  spec.name = '${name}'
  spec.version = ${rubyModule(name)}::VERSION
  spec.authors = ['${name} authors']
  spec.summary = '${name}'
  spec.license = 'Nonstandard'
  spec.required_ruby_version = '>= ${RUBY_MIN_VERSION}'
  spec.files = Dir['lib/**/*.rb']
  spec.require_paths = ['lib']
  spec.metadata['rubygems_mfa_required'] = 'true'
end
`
}

/**
 * The files of a Ruby project's worked example, as paths relative to the project to contents.
 *
 * @remarks
 * Ruby's own convention is already the vertical-slice one: a `snake_case.rb` file per constant, so `greet_use_case.rb` is
 * `GreetUseCase` with no mangling. `lib/<snake>.rb` is the barrel (it requires the slices, which is what a consumer
 * requires), a slice is a folder under `lib/<snake>/`, and the spec is mirrored under `spec/`. An app's `bin/<name>` only
 * wires.
 *
 * @param kind - Which Ruby kind.
 * @param name - The project name, which an app greets.
 * @returns The files to write.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function rubyExampleFiles (kind: RubyKind, name: string): Record<string, string> {
  const snake = rubySnake(name)
  const module = rubyModule(name)
  const files: Record<string, string> = {
    [`lib/${snake}.rb`]: `# frozen_string_literal: true

${kind === 'ruby-app' ? '' : `require_relative '${snake}/version'\n`}require_relative '${snake}/greeting/greeting_contract'
require_relative '${snake}/greeting/greet_use_case'
`,
    [`lib/${snake}/greeting/greeting_contract.rb`]: `# frozen_string_literal: true

module ${module}
  module Greeting
    # What greeting someone returns.
    GreetingContract = Struct.new(:message, keyword_init: true)
  end
end
`,
    [`lib/${snake}/greeting/greet_use_case.rb`]: `# frozen_string_literal: true

module ${module}
  module Greeting
    # Greets a name; a blank one is greeted as a stranger.
    module GreetUseCase
      def self.greet(name)
        who = name.to_s.strip
        who = 'stranger' if who.empty?

        GreetingContract.new(message: "Hello, #{who}!")
      end
    end
  end
end
`,
    '.rspec':              '--require spec_helper\n',
    'spec/spec_helper.rb': `# frozen_string_literal: true

require '${snake}'
`,
    'spec/greeting/greet_use_case_spec.rb': `# frozen_string_literal: true

RSpec.describe ${module}::Greeting::GreetUseCase do
  it 'greets a name' do
    expect(described_class.greet('Ada').message).to eq('Hello, Ada!')
  end

  it 'greets a blank name as a stranger' do
    expect(described_class.greet('   ').message).to eq('Hello, stranger!')
  end
end
`,
  }
  if (kind === 'ruby-app') {
    files[`bin/${name}`] = `#!/usr/bin/env ruby
# frozen_string_literal: true

require 'bundler/setup'
require_relative '../lib/${snake}'

puts ${module}::Greeting::GreetUseCase.greet('${name}').message
`
  } else {
    files[`lib/${snake}/version.rb`] = `# frozen_string_literal: true

module ${module}
  VERSION = '0.1.0'
end
`
  }

  return files
}

/**
 * What `mnci add ruby-app|ruby-lib --empty` writes: the barrel and spec helper, an entry script that does nothing, and a
 * spec that proves the setup.
 *
 * @remarks
 * RSpec exits non-zero on no examples, as pytest does, so a bare project keeps one spec that only asserts the barrel loads.
 *
 * @param kind - Which Ruby kind.
 * @param name - The project name.
 * @returns The files to write.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function rubyEmptyFiles (kind: RubyKind, name: string): Record<string, string> {
  const snake = rubySnake(name)
  const module = rubyModule(name)
  const files: Record<string, string> = {
    [`lib/${snake}.rb`]: `# frozen_string_literal: true
${kind === 'ruby-app' ? '' : `\nrequire_relative '${snake}/version'\n`}`,
    '.rspec':              '--require spec_helper\n',
    'spec/spec_helper.rb': `# frozen_string_literal: true

require '${snake}'
`,
    'spec/smoke_spec.rb': `# frozen_string_literal: true

RSpec.describe 'the ${name} project' do
  it 'loads' do
    expect(Object.const_defined?(:RSpec)).to be(true)
  end
end
`,
  }
  if (kind === 'ruby-app') {
    files[`bin/${name}`] = '#!/usr/bin/env ruby\n# frozen_string_literal: true\n'
  } else {
    files[`lib/${snake}/version.rb`] = `# frozen_string_literal: true

module ${module}
  VERSION = '0.1.0'
end
`
  }

  return files
}
