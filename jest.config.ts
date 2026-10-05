import type { Config } from 'jest'
import { getJestProjectsAsync } from '@nx/jest'

/**
 * Root Jest config: runs every project's own config as one multi-project run.
 *
 * @remarks
 * Written by the Nx Jest generator when the first Jest-tested project is added. Each project
 * keeps its own `jest.config.*`; this only lists them.
 *
 * @param None - this function takes no parameters.
 * @returns The Jest config, with every project Nx knows.
 * @throws Error when the Nx project graph cannot be read.
 * @typeParam None - this function has no generic type parameters.
 */
export default async (): Promise<Config> => ({
  projects: await getJestProjectsAsync(),
})
