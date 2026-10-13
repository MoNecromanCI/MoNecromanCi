import { debugExtension } from './debug-extension.mapper'

describe('debugExtension', () => {
  it('names the Marketplace extension that provides each adapter', () => {
    expect(debugExtension({ language: 'cpp', program: 'p' }).id).toBe('ms-vscode.cpptools')
    expect(debugExtension({ language: 'rust', crate: 'c', targetDirectory: 't' }).id).toBe('vadimcn.vscode-lldb')
    expect(debugExtension({ language: 'jvm', mainClass: 'm' }).id).toBe('vscjava.vscode-java-pack')
    expect(debugExtension({ language: 'php', program: 'p' }).id).toBe('xdebug.php-debug')
    expect(debugExtension({ language: 'ruby', script: 's', directory: 'd' }).id).toBe('KoichiSasada.vscode-rdbg')
  })

  it('says what else has to be on the machine, since the extension does not install it', () => {
    expect(debugExtension({ language: 'php', program: 'p' }).tool).toContain('Xdebug')
    expect(debugExtension({ language: 'cpp', program: 'p' }).tool).toContain('gdb')
  })
})
