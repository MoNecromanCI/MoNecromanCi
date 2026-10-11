import { addCmakeSibling, cppIdentifier } from './cmake-sibling.algorithm'

describe('cppIdentifier', () => {
  it('keeps a plain name and turns a hyphen or a dot into an underscore', () => {
    expect(cppIdentifier('hello')).toBe('hello')
    expect(cppIdentifier('my-tool.core')).toBe('my_tool_core')
  })

  it('does not start with a digit', () => {
    expect(cppIdentifier('2fast')).toBe('_2fast')
  })
})

describe('addCmakeSibling', () => {
  const text = 'cmake_minimum_required(VERSION 3.20)\nproject(hello VERSION 0.1.0 LANGUAGES CXX)\nadd_executable(hello src/main.cpp)\n'

  it('adds the subdirectory and links its target, with a comment saying where it came from', () => {
    expect(addCmakeSibling(text, '../../libs/kit', 'kit', 'hello')).toBe([
      text.trimEnd(),
      '',
      '# mnci: depends on kit',
      'add_subdirectory(../../libs/kit ${CMAKE_BINARY_DIR}/kit)',
      'target_link_libraries(hello PRIVATE kit)',
      '',
    ].join('\n'))
  })

  it('names the targets by identifier, so a hyphenated project still links', () => {
    expect(addCmakeSibling(text, '../../libs/my-kit', 'my-kit', 'my-app')).toContain('target_link_libraries(my_app PRIVATE my_kit)')
  })

  it('is idempotent', () => {
    const once = addCmakeSibling(text, '../../libs/kit', 'kit', 'hello')

    expect(addCmakeSibling(once, '../../libs/kit', 'kit', 'hello')).toBe(once)
  })

  it('keeps CRLF line endings', () => {
    const crlf = text.replaceAll('\n', '\r\n')

    expect(addCmakeSibling(crlf, '../../libs/kit', 'kit', 'hello')).not.toMatch(/[^\r]\n/)
  })
})
