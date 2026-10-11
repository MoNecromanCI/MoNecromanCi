/**
 * The `bicepconfig.json` of a Bicep project: the rules that catch real mistakes are errors.
 *
 * @remarks
 * `az bicep lint` exits 0 on warnings, so left at the defaults a lint target would never fail on an unused parameter or
 * a hard-coded location. `level: error` for these makes `lint` a gate.
 *
 * @param None - this function takes no parameters.
 * @returns The file contents.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function bicepConfig (): string {
  return `${JSON.stringify({
    analyzers: {
      core: {
        rules: {
          'no-unused-params':      { level: 'error' },
          'no-unused-vars':        { level: 'error' },
          'no-hardcoded-location': { level: 'error' },
        },
      },
    },
  }, null, 2)}\n`
}

/**
 * The worked example of a Bicep project: one storage account, parameterised, with a parameter file that uses it.
 *
 * @remarks
 * Small on purpose: it has a parameter with a description and length limits, a resource and an output, which is what
 * a reader needs to start from, and it passes the linter rules `bicepconfig.json` turns into errors.
 *
 * @param None - this function takes no parameters.
 * @returns The files to write, keyed by path relative to the project.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function bicepExampleFiles (): Record<string, string> {
  return {
    'main.bicep': [
      "@description('The Azure region to deploy into.')",
      'param location string = resourceGroup().location',
      '',
      "@description('The storage account name: 3 to 24 lower-case letters and digits, unique in Azure.')",
      '@minLength(3)',
      '@maxLength(24)',
      'param storageName string',
      '',
      "resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {",
      '  name: storageName',
      '  location: location',
      "  sku: { name: 'Standard_LRS' }",
      "  kind: 'StorageV2'",
      '}',
      '',
      'output storageId string = storage.id',
      '',
    ].join('\n'),
    'main.bicepparam': [
      "using './main.bicep'",
      '',
      "param storageName = 'stexample001'",
      '',
    ].join('\n'),
  }
}

/**
 * What `mnci add bicep-iac --empty` writes: a template that declares nothing, and the parameter file for it.
 *
 * @remarks
 * `build` still passes on it, so `--empty` is a template to start from, not a broken one.
 *
 * @param None - this function takes no parameters.
 * @returns The files to write, keyed by path relative to the project.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function bicepEmptyFiles (): Record<string, string> {
  return {
    'main.bicep':      ["targetScope = 'resourceGroup'", ''].join('\n'),
    'main.bicepparam': ["using './main.bicep'", ''].join('\n'),
  }
}
