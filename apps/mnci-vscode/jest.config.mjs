import { createConfig } from '../../jest.preset.mjs'

// `vscode` exists only inside the extension host, so unit tests map it to a stub.
export default {
  ...createConfig('mnci-vscode'),
  moduleNameMapper: { '^vscode$': '<rootDir>/test/vscode.stub.ts' },
}
