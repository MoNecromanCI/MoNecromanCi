import { printJson } from './json-output.client'

describe('printJson', () => {
  it('writes one parseable JSON document and a newline, with nothing around it', () => {
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)

    printJson({ a: [1, 'b'] })

    expect(write).toHaveBeenCalledTimes(1)
    const text = String(write.mock.calls[0][0])
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual({ a: [1, 'b'] })
    write.mockRestore()
  })
})
