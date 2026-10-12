import { join } from 'node:path'
import { fileExists, readJson, toJson, writeFileEnsured } from '../file-system'
import type { ProjectLocation } from './manifest.repository'

/**
 * Keeps a project's `project.json` `implicitDependencies` in step with a sibling project it depends on.
 *
 * @remarks
 * Nx infers no edge from a build file it has no plugin for, so without this an app is not affected by a change to the
 * library it uses and `nx affected` skips it. Idempotent, and leaves the file alone when nothing changes.
 *
 * @param workspaceRoot - Absolute path to the workspace.
 * @param location - The consuming project.
 * @param sibling - The sibling project's name.
 * @param present - Whether the edge should exist.
 * @returns Nothing.
 * @throws Error when `project.json` is not valid JSON.
 * @typeParam None - this function has no generic type parameters.
 */
export function setImplicitDependency (workspaceRoot: string, location: ProjectLocation, sibling: string, present: boolean): void {
  const path = join(workspaceRoot, location.dir, 'project.json')
  if (!fileExists(path)) {
    return
  }
  const project = readJson<{ implicitDependencies?: string[] } & Record<string, unknown>>(path)
  const current = project.implicitDependencies ?? []
  const next = present ? [...new Set([...current, sibling])] : current.filter(name => name !== sibling)
  if (next.length === current.length && next.every((name, index) => name === current[index])) {
    return
  }
  const { implicitDependencies: _previous, ...rest } = project
  writeFileEnsured(path, toJson(next.length > 0 ? { ...rest, implicitDependencies: next } : rest))
}
