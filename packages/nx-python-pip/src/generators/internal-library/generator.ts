import { addProjectConfiguration, formatFiles, type Tree } from '@nx/devkit'
import {
  pythonModuleDirectory,
  pythonPyprojectToml,
  pythonReadme,
  pythonSampleBarrel,
  PYTHON_EMPTY_BARREL,
  PYTHON_SAMPLE_CONTRACT,
  pythonEmptyTest,
  pythonSampleModule,
  pythonSampleTest,
  pythonTypedMarkerPath,
} from '../../internal/python-project.algorithm'
import type { InternalLibraryGeneratorSchema } from './schema.d'

/**
 * Generates a private, never-published Python library: `pyproject.toml` +
 * `project.json` (lint/test only) + a sample module and pytest.
 *
 * @remarks
 * No `build` target: an internal lib is never built or packaged on its own —
 * a consumer vendors its module directly into its own wheel at build time by
 * hand-adding a `[tool.mnci-python-pip] vendor = ["<this-lib>"]` entry to its
 * own `pyproject.toml` (see the `build` executor).
 *
 * @param tree - The Nx virtual file system.
 * @param options - The project name and directory.
 * @returns A promise that resolves once generated files are formatted.
 * @throws Never - pure Tree writes.
 * @typeParam None - this function has no generic type parameters.
 */
export default async function internalLibraryGenerator (
  tree: Tree,
  options: InternalLibraryGeneratorSchema,
): Promise<void> {
  const root = options.directory ?? `libs/${options.name}`
  const moduleDirectory = pythonModuleDirectory(options.name)

  addProjectConfiguration(tree, options.name, {
    root,
    projectType: 'library',
    sourceRoot:  root,
    targets:     {
      lint: { executor: '@mnci/nx-python-pip:lint', options: {} },
      test: { executor: '@mnci/nx-python-pip:test', options: {} },
    },
  })

  tree.write(`${root}/pyproject.toml`, pythonPyprojectToml(options.name, moduleDirectory))
  tree.write(`${root}/README.md`, pythonReadme(options.name, moduleDirectory))
  if (options.empty) {
    tree.write(`${root}/${moduleDirectory}/__init__.py`, PYTHON_EMPTY_BARREL)
    tree.write(`${root}/tests/test_${moduleDirectory}.py`, pythonEmptyTest(moduleDirectory))
  } else {
    tree.write(`${root}/${moduleDirectory}/${moduleDirectory}_contract.py`, PYTHON_SAMPLE_CONTRACT)
    tree.write(`${root}/${moduleDirectory}/${moduleDirectory}_use_case.py`, pythonSampleModule(moduleDirectory))
    tree.write(`${root}/${moduleDirectory}/__init__.py`, pythonSampleBarrel(moduleDirectory))
    tree.write(`${root}/tests/test_${moduleDirectory}_use_case.py`, pythonSampleTest(moduleDirectory))
  }
  tree.write(`${root}/${pythonTypedMarkerPath(moduleDirectory)}`, '')
  await formatFiles(tree)
}
