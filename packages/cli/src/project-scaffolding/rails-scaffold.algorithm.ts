/**
 * The files of a Rails app's worked example, as paths relative to the app to contents.
 *
 * @remarks
 * Rails mandates `app/controllers`, `app/models`, `app/views`, `config/` and `db/`, so the framework's own folders stay as
 * they are and the example lives beside them in `app/features/greeting` (every folder under `app/` is an autoload root): a
 * contract and a use case in the Ruby mapping of the vertical-slice rules (`<snake>_<role>.rb`), which a controller calls,
 * so no logic sits in the controller. Both tests are Rails' own Minitest shapes: a plain case for the use case and an
 * integration test for the route.
 *
 * @param None - this function takes no parameters.
 * @returns The files to write.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function railsExampleFiles (): Record<string, string> {
  return {
    'app/features/greeting/greeting_contract.rb': `module Greeting
  # What greeting someone returns.
  GreetingContract = Data.define(:message)
end
`,
    'app/features/greeting/greet_use_case.rb': `module Greeting
  # Greets a name; a blank one is greeted as a stranger.
  class GreetUseCase
    def self.call(name)
      who = name.to_s.strip
      who = "stranger" if who.empty?

      GreetingContract.new(message: "Hello, #{who}!")
    end
  end
end
`,
    'app/controllers/hello_controller.rb': `class HelloController < ApplicationController
  def show
    render json: { message: Greeting::GreetUseCase.call(params[:name]).message }
  end
end
`,
    'test/features/greeting/greet_use_case_test.rb': `require "test_helper"

class GreetUseCaseTest < ActiveSupport::TestCase
  test "greets a name" do
    assert_equal "Hello, Ada!", Greeting::GreetUseCase.call("Ada").message
  end

  test "greets a blank name as a stranger" do
    assert_equal "Hello, stranger!", Greeting::GreetUseCase.call("   ").message
  end
end
`,
    'test/controllers/hello_controller_test.rb': `require "test_helper"

class HelloControllerTest < ActionDispatch::IntegrationTest
  test "the hello route returns the greeting" do
    get "/hello/Ada"

    assert_response :success
    assert_equal "Hello, Ada!", response.parsed_body["message"]
  end
end
`,
  }
}

/**
 * Adds the worked example's route to Rails' `config/routes.rb`.
 *
 * @remarks
 * The file is the framework's own, so it is edited rather than replaced: the route goes right after the `draw do` line.
 * Idempotent, and a file that already names the controller is returned unchanged.
 *
 * @param text - The text of `config/routes.rb`.
 * @returns The text with the route added.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function addHelloRoute (text: string): string {
  if (text.includes('hello#show')) {
    return text
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'

  return text.replace(
    /^(Rails\.application\.routes\.draw do)[ \t]*(\r?\n)/m,
    (_match, opening: string, ending: string) => `${opening}${ending}  get "/hello/:name", to: "hello#show"${newline}${newline}`,
  )
}

/**
 * A Rails app's `.gitignore`.
 *
 * @remarks
 * `rails new --skip-git` writes none, and `git add -A` after a run would commit the log, the temporary files, the SQLite
 * databases and the master key. Keeps the `.keep` files Rails creates.
 *
 * @param None - this function takes no parameters.
 * @returns The text of `.gitignore`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function railsGitignore (): string {
  return `/.bundle
/log/*
!/log/.keep
/tmp/*
!/tmp/.keep
/storage/*
!/storage/.keep
/public/assets
/config/*.key
/db/*.sqlite3
/db/*.sqlite3-*
.env*
!.env.example
`
}

/**
 * The targets of a Rails app, written explicitly because nothing infers them.
 *
 * @remarks
 * Rails' own tools run from the app: Minitest (`bin/rails test`) and RuboCop with the app's own omakase `.rubocop.yml`, so
 * unlike a plain Ruby project nothing is shared from the workspace root. Bundler installs into the machine's gem home, so
 * `build` is not cached (a cache hit elsewhere would skip an install that is needed). `bin/rails` is run through `ruby`,
 * which a Windows shell cannot do with a shebang. There is no `slice-check`: the framework mandates its folder names and
 * `*_controller.rb`, which the check would reject (the exception is written in the CLI README).
 *
 * @param name - The project name.
 * @param directory - The project's workspace-relative directory.
 * @returns The Nx targets to merge into the project's `project.json`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function railsTargets (name: string, directory: string): Record<string, unknown> {
  return {
    build: {
      executor: 'nx:run-commands',
      options:  { command: 'bundle install', cwd: directory },
    },
    test: {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      options:   { command: 'bundle exec ruby bin/rails test', cwd: directory },
    },
    lint: {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      options:   { command: 'bundle exec rubocop', cwd: directory },
    },
    start: {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      options:   { command: 'bundle exec ruby bin/rails server', cwd: directory },
    },
    package: {
      executor:  'nx:run-commands',
      dependsOn: ['build'],
      outputs:   [`{workspaceRoot}/dist/drop/ruby-app-${name}.zip`],
      options:   {
        command: `node -e "const fs=require('node:fs');fs.mkdirSync('dist/drop',{recursive:true});const A=require('adm-zip');const z=new A();const keep=p=>!p.endsWith('.sqlite3');for(const d of ['app','bin','config','db','lib','public'])if(fs.existsSync('${directory}/'+d))z.addLocalFolder('${directory}/'+d,d,keep);for(const f of ['Gemfile','Gemfile.lock','config.ru','Rakefile','.ruby-version'])if(fs.existsSync('${directory}/'+f))z.addLocalFile('${directory}/'+f);z.writeZip('dist/drop/ruby-app-${name}.zip')"`,
      },
    },
  }
}
