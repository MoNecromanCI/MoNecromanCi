import type { OrchestrationContext, Task } from 'durable-functions'
import type { EntityContext } from 'durable-functions'
import type { EntityOperations, TypedEntity } from './entity.js'
import type { TypedOrchestration } from './types.js'

/**
 * A recorded activity or sub-orchestration call.
 *
 * @remarks
 * The ORDER of these is what replay compatibility depends on, which is why the
 * harness returns them as a list rather than a set: reordering two activity
 * calls is a breaking change to an orchestration, and this is what makes that
 * directly assertable.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface RecordedCall {
  /** The activity or orchestration name, as scheduled. */
  readonly name:       string
  /** The input it was scheduled with. */
  readonly input:      unknown
  /** For an entity call or signal, the key of the entity instance it went to. */
  readonly entityKey?: string
  /** True for `signalEntity`: sent, not awaited, so no stub is consulted. */
  readonly signal?:    boolean
  /**
   * How many attempts the call made, present only when it was scheduled with a retry policy.
   *
   * @remarks
   * A stub that keeps returning an `Error` is called `maxNumberOfAttempts` times and then throws inside the
   * orchestration; one that succeeds on the third try reports `3`.
   */
  attempts?:           number
}

/**
 * What a stubbed activity returns, or an `Error` to make it throw.
 *
 * @remarks
 * Deliberately `unknown` rather than generic: a stub map covers many activities
 * with different outputs, so a single parameter could only be their union,
 * which is less useful than an explicit cast at the one place it matters.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type StubResult = unknown

/**
 * The fakes a workflow run is driven against.
 *
 * @remarks
 * `activities` is keyed by the same name literal `defineActivity` registered —
 * deliberately, since that string is the contract the task hub stores.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface WorkflowStub {
  /**
   * Result per activity name. Returning an `Error` instance makes that call
   * THROW inside the orchestration, which is how failure branches and
   * retry-exhaustion paths become testable.
   */
  readonly activities:  Record<string, (input: unknown) => StubResult>
  /**
   * Result per entity operation, keyed `<entity name>.<operation>`, called with the input and the entity key.
   *
   * @remarks
   * Optional: only an orchestration that waits on `callEntity` needs it. An `Error` made throws inside the
   * orchestration, as for an activity. To test the entity itself, use {@link runEntity}.
   */
  readonly entities?:   Record<string, (input: unknown, key: string) => StubResult>
  /** Fixed clock, so time-dependent output is deterministic. Defaults to the epoch. */
  readonly now?:        Date
  /** Instance id the orchestration sees. Defaults to `test-instance`. */
  readonly instanceId?: string
  /**
   * Picks the winner of a `Task.any` race, by scheduled name.
   *
   * @remarks
   * Defaults to the first candidate, and returning `undefined` accepts that
   * default — so a selector only has to name the cases it cares about, rather
   * than inventing a fallback for a list it knows is non-empty. Worth setting
   * whenever a race decides something important: the approval-versus-timeout
   * pattern has a branch per outcome, and with a fixed winner only one of them
   * is ever reachable. A timer candidate is named `__timer`.
   */
  readonly raceWinner?: (candidates: string[]) => string | undefined
}

/**
 * What a completed {@link runWorkflow} reports.
 *
 * @remarks
 * `calls` and `statuses` are ordered lists rather than sets because the order
 * is the property worth asserting: it is what replay compatibility depends on.
 *
 * @typeParam TInput - The orchestration's input type.
 * @typeParam TOutput - The orchestration's return type.
 */
export interface WorkflowRun<TInput, TOutput> {
  /** The orchestration's return value. */
  readonly result:          TOutput
  /** Every activity and sub-orchestration call, in order. */
  readonly calls:           RecordedCall[]
  /** Every `setCustomStatus` transition, in order. */
  readonly statuses:        string[]
  /**
   * The input the orchestration asked to restart with, if it called
   * `self.continueAsNew`.
   *
   * @remarks
   * The harness records the request and lets the run finish rather than
   * looping: an eternal orchestration restarts forever by design, so a harness
   * that honoured it would never return. What is worth asserting is that the
   * restart was requested and with what — the next generation is then a
   * separate `runWorkflow` call with that input.
   */
  readonly continuedAsNew?: TInput
}

/**
 * A stub's request that the orchestration see a thrown error.
 *
 * @remarks
 * Returned by `resolve` rather than thrown, so the driver can inject it with
 * `generator.throw` — which is what puts it inside the orchestration's own
 * `try`. Harness errors (a missing stub, a bad `raceWinner`) keep throwing
 * normally: those are the test author's mistakes, and swallowing one in an
 * orchestration's `catch` would turn a broken test green.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
interface ThrowRequest {
  readonly __throw: Error
}

/** A task the fake context hands back; carries what was scheduled. */
interface FakeTask extends Task {
  readonly __name:       string
  /** Present on an entity call: the key of the instance. */
  readonly __entityKey?: string
  readonly __input:      unknown
  /** Total attempts a retry policy allows; absent when the call has none. */
  readonly __retry?:     number
  /** The recorded call, so the attempts made can be written onto it. */
  readonly __record?:    RecordedCall
  /** Present on timers only. Set by `cancel()`. */
  isCanceled?:           boolean
  cancel?:               () => void
}

/**
 * Runs an orchestration against stubbed activities, with no Azure running.
 *
 * @remarks
 * Drives the generator synchronously, feeding each yielded task the stubbed
 * result for that activity's name. There is no host, no emulator and no
 * storage — a three-step workflow with a short-circuit branch is testable in
 * about fifteen lines.
 *
 * **How it intercepts.** The orchestration is driven with a fake
 * `OrchestrationContext`, which works only because every scheduling call in
 * this package goes through `context.df` rather than through the registered
 * callable. The alternative — reading the name off `task.action.functionName` —
 * is an undocumented SDK internal the package's non-goals forbid.
 *
 * **Retries.** A call scheduled with a retry policy calls its stub again after
 * each `Error`, up to `maxNumberOfAttempts`, and reports the attempts made on
 * the recorded call. Exhaustion throws the last error inside the orchestration.
 * The retry intervals are not waited for.
 *
 * **Limits, stated rather than discovered later.** `Task.any` resolves to the
 * FIRST task in the list unless `raceWinner` says otherwise, since there is
 * no real concurrency to race. Timers complete immediately.
 *
 * @param orchestration - The orchestration to run.
 * @param input - The input, checked against its declared type.
 * @param stub - The activity fakes, clock and instance id.
 * @returns The result, the ordered calls, and the status transitions.
 * @throws Error when an activity is called with no stub registered for it.
 * @typeParam TInput - The orchestration's input type.
 * @typeParam TOutput - The orchestration's output type.
 */
export function runWorkflow<TInput, TOutput> (
  orchestration: TypedOrchestration<TInput, TOutput>,
  input: TInput,
  stub: WorkflowStub,
): WorkflowRun<TInput, TOutput> {
  const calls: RecordedCall[] = []
  const statuses: string[] = []
  let continuedAsNew: TInput | undefined
  const clock = stub.now ?? new Date(0)

  const schedule = (name: string, scheduledInput: unknown, retry?: unknown, entityKey?: string): FakeTask => {
    const record: RecordedCall = entityKey === undefined
      ? { name, input: scheduledInput }
      : { name, input: scheduledInput, entityKey }
    calls.push(record)
    const attempts = (retry as { maxNumberOfAttempts?: unknown } | undefined)?.maxNumberOfAttempts

    return {
      isCompleted: false,
      isFaulted:   false,
      __name:      name,
      __input:     scheduledInput,
      ...(entityKey !== undefined && { __entityKey: entityKey }),
      ...((typeof attempts === 'number') && { __retry: attempts, __record: record }),
    }
  }

  const context = {
    df: {
      instanceId:                   stub.instanceId ?? 'test-instance',
      isReplaying:                  false,
      currentUtcDateTime:           clock,
      callActivity:                 schedule,
      callActivityWithRetry:        (name: string, retry: unknown, i: unknown) => schedule(name, i, retry),
      callSubOrchestrator:          (name: string, i: unknown) => schedule(name, i),
      callSubOrchestratorWithRetry: (name: string, retry: unknown, i: unknown) =>
        schedule(name, i, retry),
      waitForExternalEvent: (name: string) => schedule(name, undefined),
      callEntity:           (id: { name: string, key: string }, operation: string, i: unknown) =>
        schedule(`${id.name}.${operation}`, i, undefined, id.key),
      signalEntity: (id: { name: string, key: string }, operation: string, i: unknown) => {
        calls.push({ name: `${id.name}.${operation}`, input: i, entityKey: id.key, signal: true })
      },
      // Timers complete immediately: there is no real time to wait for, and a
      // harness that blocked on one would be useless. `cancel` is real,
      // because an orchestration that correctly cancels its losing timer must
      // not crash in a test for doing the right thing.
      createTimer: (fireAt: Date) => {
        const timer = schedule('__timer', fireAt.toISOString())
        timer.isCanceled = false
        timer.cancel = () => {
          timer.isCanceled = true
        }

        return timer
      },
      setCustomStatus: (value: unknown) => {
        statuses.push(String(value))
      },
      continueAsNew: (next: unknown) => {
        continuedAsNew = next as TInput
      },
      Task: {
        all: (tasks: Task[]) => ({ isCompleted: false, isFaulted: false, __all: tasks }),
        // A marker, not a winner. `Task.any` resolves to the winning TASK, not
        // to its value, so choosing here would hand the orchestration the
        // wrong kind of thing — which is exactly the bug the reconstructed
        // workflows found.
        any: (tasks: Task[]) => ({ isCompleted: false, isFaulted: false, __any: tasks }),
      },
    },
  } as unknown as OrchestrationContext

  const generator = orchestration.handler(context, input)
  let step = generator.next()
  while (!step.done) {
    const resumed = resolve(step.value, stub)
    // INTO the generator, not out of the driver. Throwing here instead is the
    // bug the reconstructed workflows found: every compensation branch was
    // unreachable, while the docstring promised the opposite.
    step = isThrowRequest(resumed)
      ? generator.throw(resumed.__throw)
      : generator.next(resumed)
  }

  return continuedAsNew === undefined
    ? { result: step.value, calls, statuses }
    : { result: step.value, calls, statuses, continuedAsNew }
}

/**
 * Produces the value the driver resumes a yielded task with.
 *
 * @remarks
 * Separated so the `Task.all` fan-out case — where one yielded task stands for
 * several — is handled in one place rather than inline in the drive loop.
 *
 * @param task - The task the orchestration yielded.
 * @param stub - The stubs to resolve against.
 * @returns The value to resume with, or a {@link ThrowRequest} for the driver to inject.
 * @throws Error naming an activity with no stub registered.
 * @typeParam None - this function has no generic type parameters.
 */
function resolve (task: Task, stub: WorkflowStub): unknown {
  const fanOut = (task as { __all?: Task[] }).__all
  if (fanOut !== undefined) {
    return fanOut.map(t => resolve(t, stub))
  }
  const race = (task as { __any?: Task[] }).__any
  if (race !== undefined) {
    return resolveRace(race, stub)
  }
  const { __name: name, __input: input, __retry: retry, __record: record, __entityKey: entityKey } = task as FakeTask
  if (name === '__timer') {
    return undefined
  }
  const entityStub = entityKey === undefined ? undefined : stub.entities?.[name]
  if (entityKey !== undefined) {
    if (entityStub === undefined) {
      throw new Error(`No stub registered for entity operation '${name}'. Add it to stub.entities to run this workflow.`)
    }
    const outcome = entityStub(input, entityKey)

    return outcome instanceof Error ? { __throw: outcome } : outcome
  }
  const activity = stub.activities[name]
  if (activity === undefined) {
    // Naming the activity matters: the alternative is `undefined` flowing into
    // the orchestration and failing somewhere unrelated.
    throw new Error(
      `No stub registered for '${name}'. Add it to stub.activities to run this workflow.`,
    )
  }
  // A call with a retry policy is attempted up to its limit, as the host does: the stub is called again after each
  // `Error`, so one that fails twice and then succeeds is testable, and one that never succeeds exhausts the policy.
  const limit = Math.max(1, retry ?? 1)
  let result = activity(input)
  let attempts = 1
  while (result instanceof Error && attempts < limit) {
    result = activity(input)
    attempts += 1
  }
  if (record !== undefined) {
    record.attempts = attempts
  }
  if (result instanceof Error) {
    // A returned Error becomes a THROWN error inside the orchestration, which
    // is what makes failure branches testable at all. Handed back as a request
    // so the DRIVER injects it; see {@link ThrowRequest}.
    return { __throw: result }
  }

  return result
}

/**
 * Settles a `Task.any` race and returns the winning TASK.
 *
 * @remarks
 * The distinction that matters: the SDK's `Task.any` resolves to the winning
 * task object, not to its value, and callers read the value afterwards with
 * `resultOf`. An earlier harness returned the resolved value instead, which
 * made every orchestration using a race fail with "Task.any returned a task
 * that was not one of the inputs" — correct code, rejected by the fake.
 *
 * The winner's `result` is populated and `isCompleted` set, so `resultOf` and
 * an `isCompleted` check on the loser both behave as they do in production.
 *
 * @param candidates - The racing tasks.
 * @param stub - The stubs to resolve the winner against.
 * @returns The winning task, completed and carrying its result.
 * @throws Error when `raceWinner` names a task that is not racing.
 * @typeParam None - this function has no generic type parameters.
 */
function resolveRace (candidates: Task[], stub: WorkflowStub): Task {
  const names = candidates.map(c => (c as FakeTask).__name)
  const chosen = stub.raceWinner?.(names) ?? names[0]
  const winner = candidates.find(c => (c as FakeTask).__name === chosen)
  if (winner === undefined) {
    throw new Error(
      `raceWinner chose '${String(chosen)}', which is not racing. Candidates: ${names.join(', ')}.`,
    )
  }
  const mutable = winner as { result?: unknown; isCompleted: boolean }
  mutable.result = (winner as FakeTask).__name === '__timer' ? undefined : resolve(winner, stub)
  mutable.isCompleted = true

  return winner
}

/**
 * Whether a resolved value is a request to throw inside the orchestration.
 *
 * @param value - Whatever `resolve` produced.
 * @returns `true` when the driver should call `generator.throw`.
 * @throws Never - a type guard.
 * @typeParam None - this function has no generic type parameters.
 */
function isThrowRequest (value: unknown): value is ThrowRequest {
  return typeof value === 'object' && value !== null && '__throw' in value
}

/**
 * One operation to run against an entity: its name and input.
 *
 * @remarks
 * The step list of {@link runEntity}.
 *
 * @typeParam None - this interface has no generic type parameters.
 */
export interface EntityStep {
  /** The operation name. */
  readonly operation: string
  /** The input the operation receives. */
  readonly input?:    unknown
}

/**
 * What {@link runEntity} reports.
 *
 * @remarks
 * Results are positional, one per step run.
 *
 * @typeParam TState - The entity's state type.
 */
export interface EntityRun<TState> {
  /** The state after the last step, or `undefined` when an operation destroyed the entity. */
  readonly state:     TState | undefined
  /** The result of each step, in order (`undefined` for a step that returned none). */
  readonly results:   unknown[]
  /** True when an operation asked for the entity to be deleted. */
  readonly destroyed: boolean
}

/**
 * Runs an entity's operations in order against a fake entity context, with no Azure running.
 *
 * @remarks
 * The entity's real handler is driven, so a missing operation, the initial state and the result hand-back behave as on
 * the host. Each step sees the state the previous one stored. Signalling another entity from inside an operation is not
 * part of this package's entity API, so it is not simulated.
 *
 * @param entity - The entity to run.
 * @param steps - The operations to run, in order.
 * @param initial - A state to start from instead of the entity's initial state.
 * @returns The final state and each step's result.
 * @throws Error naming an operation the entity does not have.
 * @typeParam TState - The entity's state type.
 * @typeParam TOperations - The entity's operations.
 */
export function runEntity<TState, TOperations extends EntityOperations<TState>> (
  entity: TypedEntity<TState, TOperations>,
  steps: readonly EntityStep[],
  initial?: TState,
): EntityRun<TState> {
  let state: TState | undefined = initial
  let destroyed = false
  const results: unknown[] = []
  for (const step of steps) {
    let returned: unknown
    const context = {
      df: {
        operationName: step.operation,
        getState:      (initializer?: () => TState) => {
          state ??= initializer?.()

          return state
        },
        setState: (next: TState) => {
          state = next
        },
        getInput: () => step.input,
        return:   (value: unknown) => {
          returned = value
        },
        destructOnExit: () => {
          destroyed = true
        },
      },
    } as unknown as EntityContext<TState>
    entity.handler(context)
    results.push(returned)
    if (destroyed) {
      state = undefined
      break
    }
  }

  return { state, results, destroyed }
}
