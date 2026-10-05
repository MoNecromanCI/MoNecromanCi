import type { CliJsonResult, CliLocation } from '../cli-access'
import type {
  CommandDescription,
  DoctorReport,
  ProjectKindDescription,
  ProjectSummary,
  WorkspaceInfo,
} from '../cli-contracts'

/**
 * What a session needs from the outside, so a test can supply it.
 *
 * @remarks
 * `locate` is called once per refresh; `run` is how the CLI is asked for JSON.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface CliSessionDependencies {
  /** The first workspace folder, or `undefined` when none is open. */
  readonly workspaceRoot:     string | undefined
  /** Where to run commands that do not need a workspace. */
  readonly fallbackDirectory: string
  readonly locate:            () => CliLocation
  readonly run:               <T>(location: CliLocation, arguments_: readonly string[], cwd: string) => Promise<CliJsonResult<T>>
}

/**
 * The CLI's answers, fetched once and shared by every view until a refresh.
 *
 * @remarks
 * Each answer is cached as a promise, so three views asking at once cause one process. A
 * refresh forgets everything, re-locates the CLI (a setting or an install may have changed)
 * and tells the listeners. `doctor` is not cached: it is a check, and a stale result is wrong.
 * `projects` is empty, not an error, when no workspace is open.
 * @typeParam None - this class has no generic type parameters.
 */
export class CliSession {
  private cachedLocation: CliLocation | undefined
  private cachedCommands: Promise<CommandDescription[]> | undefined
  private cachedKinds:    Promise<ProjectKindDescription[]> | undefined
  private cachedProjects: Promise<ProjectSummary[]> | undefined
  private cachedInfo:     Promise<WorkspaceInfo> | undefined
  private readonly listeners = new Set<() => void>()

  constructor (private readonly dependencies: CliSessionDependencies) {}

  /**
   * Asks the CLI for one JSON document.
   *
   * @param arguments_ - The mnci arguments.
   * @param needsWorkspace - Whether it only makes sense inside a workspace.
   * @returns The parsed document.
   */
  private async ask<T> (arguments_: readonly string[], needsWorkspace: boolean): Promise<T> {
    if (needsWorkspace && this.dependencies.workspaceRoot === undefined) {
      throw new Error('Open a folder that holds an mnci workspace first.')
    }
    const cwd = this.dependencies.workspaceRoot ?? this.dependencies.fallbackDirectory
    const result = await this.dependencies.run<T>(this.location(), arguments_, cwd)

    return result.value
  }

  /**
   * The workspace folder the session works in.
   *
   * @returns The folder, or `undefined` when none is open.
   */
  get workspaceRoot (): string | undefined {
    return this.dependencies.workspaceRoot
  }

  /**
   * Where the CLI was found.
   *
   * @returns The located CLI.
   */
  location (): CliLocation {
    this.cachedLocation ??= this.dependencies.locate()

    return this.cachedLocation
  }

  /**
   * Every CLI command with its description.
   *
   * @returns The commands.
   */
  commands (): Promise<CommandDescription[]> {
    this.cachedCommands ??= this.ask<CommandDescription[]>(['commands', '--json'], false)

    return this.cachedCommands
  }

  /**
   * Every project kind `add` accepts.
   *
   * @returns The kinds.
   */
  kinds (): Promise<ProjectKindDescription[]> {
    this.cachedKinds ??= this.ask<ProjectKindDescription[]>(['kinds', '--json'], false)

    return this.cachedKinds
  }

  /**
   * The workspace's projects.
   *
   * @returns The projects, or none when no workspace is open.
   */
  projects (): Promise<ProjectSummary[]> {
    if (this.dependencies.workspaceRoot === undefined) {
      return Promise.resolve([])
    }
    this.cachedProjects ??= this.ask<ProjectSummary[]>(['projects', '--json'], true)

    return this.cachedProjects
  }

  /**
   * The installed and newest CLI versions and the workspace settings.
   *
   * @returns The report.
   */
  info (): Promise<WorkspaceInfo> {
    this.cachedInfo ??= this.ask<WorkspaceInfo>(['info', '--json'], false)

    return this.cachedInfo
  }

  /**
   * Runs the invariant check now.
   *
   * @returns The report; its `failed` count is non-zero when a check failed.
   */
  async doctor (): Promise<DoctorReport> {
    return await this.ask<DoctorReport>(['doctor', '--json'], true)
  }

  /**
   * Subscribes to refreshes.
   *
   * @param listener - Called after every refresh.
   * @returns A function that unsubscribes.
   */
  onDidChange (listener: () => void): () => void {
    this.listeners.add(listener)

    return () => { this.listeners.delete(listener) }
  }

  /**
   * Forgets every cached answer, re-locates the CLI, and notifies the listeners.
   *
   * @returns Nothing.
   */
  refresh (): void {
    this.cachedLocation = undefined
    this.cachedCommands = undefined
    this.cachedKinds = undefined
    this.cachedProjects = undefined
    this.cachedInfo = undefined
    for (const listener of this.listeners) {
      listener()
    }
  }
}
