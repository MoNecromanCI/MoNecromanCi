import { addHelloRoute, railsExampleFiles, railsGitignore, railsTargets } from './rails-scaffold.algorithm'

const ROUTES = [
  'Rails.application.routes.draw do',
  '  # root "posts#index"',
  'end',
  '',
].join('\n')

describe('railsExampleFiles', () => {
  it('puts the example in a features slice with the role in the file name and tests beside Rails\' own folders', () => {
    expect(Object.keys(railsExampleFiles()).sort((a, b) => a.localeCompare(b))).toEqual([
      'app/controllers/hello_controller.rb',
      'app/features/greeting/greet_use_case.rb',
      'app/features/greeting/greeting_contract.rb',
      'test/controllers/hello_controller_test.rb',
      'test/features/greeting/greet_use_case_test.rb',
    ])
  })

  it('keeps the logic in the use case and has the controller call it', () => {
    const files = railsExampleFiles()

    expect(files['app/controllers/hello_controller.rb']).toContain('Greeting::GreetUseCase.call')
    expect(files['app/features/greeting/greet_use_case.rb']).toContain('GreetingContract.new')
  })
})

describe('addHelloRoute', () => {
  it('adds the route right after the draw block opens', () => {
    expect(addHelloRoute(ROUTES)).toBe([
      'Rails.application.routes.draw do',
      '  get "/hello/:name", to: "hello#show"',
      '',
      '  # root "posts#index"',
      'end',
      '',
    ].join('\n'))
  })

  it('is idempotent', () => {
    const once = addHelloRoute(ROUTES)

    expect(addHelloRoute(once)).toBe(once)
  })

  it('keeps the file\'s line endings', () => {
    expect(addHelloRoute(ROUTES.replaceAll('\n', '\r\n'))).toContain('hello#show"\r\n\r\n')
  })
})

describe('railsGitignore', () => {
  it('ignores the log, temporary files, databases and keys but keeps the .keep files', () => {
    const text = railsGitignore()

    expect(text).toContain('/db/*.sqlite3')
    expect(text).toContain('/config/*.key')
    expect(text).toContain('!/log/.keep')
  })
})

describe('railsTargets', () => {
  it('runs the app\'s own tools from its folder and has no slice-check', () => {
    const targets = railsTargets('shop', 'apps/shop') as Record<string, { options: { cwd?: string, command?: string } }>

    expect(Object.keys(targets).sort((a, b) => a.localeCompare(b))).toEqual(['build', 'lint', 'package', 'start', 'test'])
    expect(targets.test.options).toEqual({ command: 'bundle exec ruby bin/rails test', cwd: 'apps/shop' })
    expect(targets.lint.options).toEqual({ command: 'bundle exec rubocop', cwd: 'apps/shop' })
  })
})
