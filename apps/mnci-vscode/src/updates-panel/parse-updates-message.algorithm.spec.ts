import { parseUpdatesMessage } from './parse-updates-message.algorithm'

describe('parseUpdatesMessage', () => {
  it('reads an update request and a refresh', () => {
    expect(parseUpdatesMessage({ type: 'update', names: ['@nx/js', 'ts-jest', '@nx/js'] })).toEqual({ type: 'update', names: ['@nx/js', 'ts-jest'] })
    expect(parseUpdatesMessage({ type: 'refresh' })).toEqual({ type: 'refresh' })
  })

  it('accepts each ecosystem\'s spelling of a name', () => {
    expect(parseUpdatesMessage({ type: 'update', names: ['github.com/spf13/cobra', 'com.google.guava:guava', 'Newtonsoft.Json', 'monolog/monolog'] })).toBeDefined()
  })

  it('refuses a request any of whose names could be read as an option or a command', () => {
    expect(parseUpdatesMessage({ type: 'update', names: ['ok', '--yes'] })).toBeUndefined()
    expect(parseUpdatesMessage({ type: 'update', names: ['a b'] })).toBeUndefined()
    expect(parseUpdatesMessage({ type: 'update', names: ['a; rm -rf /'] })).toBeUndefined()
    expect(parseUpdatesMessage({ type: 'update', names: ['$(x)'] })).toBeUndefined()
  })

  it('refuses anything that is not a request', () => {
    expect(parseUpdatesMessage(undefined)).toBeUndefined()
    expect(parseUpdatesMessage('update')).toBeUndefined()
    expect(parseUpdatesMessage({ type: 'update', names: [] })).toBeUndefined()
    expect(parseUpdatesMessage({ type: 'update', names: [1] })).toBeUndefined()
    expect(parseUpdatesMessage({ type: 'open', url: 'https://x' })).toBeUndefined()
  })
})
