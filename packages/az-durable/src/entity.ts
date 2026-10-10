import * as df from 'durable-functions'
import type { DurableClient, EntityContext, OrchestrationContext, Task } from 'durable-functions'
import { claimName } from './registry.js'
import type { TypedTask } from './types.js'

/**
 * What an entity operation hands back: the next state, and optionally a result for a caller that waits.
 *
 * @remarks
 * Explicit rather than "mutate the state and return": an entity's state is JSON, so a counter is a bare number and cannot be
 * mutated in place. An operation that returns no `result` is a pure signal. `destroy` deletes the entity when the operation
 * finishes (the SDK's `destructOnExit`).
 *
 * @typeParam TState - The entity's state type.
 * @typeParam TResult - The result type, `void` for an operation that returns nothing.
 */
export interface EntityOutcome<TState, TResult = void> {
  /** The state to store. */
  readonly state:    TState
  /** Returned to a `callEntity` caller. Ignored by a signal. */
  readonly result?:  TResult
  /** Delete the entity once this operation finishes. */
  readonly destroy?: boolean
}

/**
 * The operations of an entity: a name to a function from the current state and an input to an {@link EntityOutcome}.
 *
 * @remarks
 * The input is typed `never` in the constraint, which is what lets one map hold operations with different inputs; each
 * operation's own signature is what callers are checked against.
 *
 * @typeParam TState - The entity's state type.
 */
export type EntityOperations<TState> = Record<string, (state: TState, input: never) => EntityOutcome<TState, unknown>>

/**
 * An entity with its state and operations attached.
 *
 * @remarks
 * `handler` is retained so `runEntity` can drive it without a Functions host, as `TypedOrchestration` does.
 * Reading it outside `@mnci/az-durable/testing` is not supported.
 *
 * @typeParam TState - The entity's state type.
 * @typeParam TOperations - The operations map, whose signatures callers are checked against.
 */
export interface TypedEntity<TState, TOperations extends EntityOperations<TState>> {
  /** The entity name as registered, verbatim. */
  readonly name:         string
  /** The initial state of a key that has none yet. */
  readonly initialState: () => TState
  /** The operations, retained for the test harness. */
  readonly operations:   TOperations
  /** The entity handler the host runs. */
  readonly handler:      (context: EntityContext<TState>) => void
}

/**
 * The input an operation takes.
 *
 * @remarks
 * Read off the operation's own signature, so the call site is checked against what the operation declares.
 *
 * @typeParam TOperations - The entity's operations.
 * @typeParam TName - The operation name.
 */
export type EntityInput<TOperations, TName extends keyof TOperations> =
  TOperations[TName] extends (state: never, input: infer TInput) => unknown ? TInput : never

/**
 * The result an operation hands a caller that waits.
 *
 * @remarks
 * Read off the operation's own return type, so a caller never restates it.
 *
 * @typeParam TOperations - The entity's operations.
 * @typeParam TName - The operation name.
 */
export type EntityResult<TOperations, TName extends keyof TOperations> =
  TOperations[TName] extends (...args: never[]) => EntityOutcome<unknown, infer TResult> ? TResult : never

/**
 * Registers an entity and remembers its state and operations.
 *
 * @remarks
 * The name is baked into the task hub like an activity's, so it is a literal and registering it twice throws. An operation
 * name a caller sends that the entity does not have fails the call with the operations it does have.
 *
 * @param name - The entity name, a literal.
 * @param definition - The initial state and the operations.
 * @returns The entity, carrying its state and operation types.
 * @throws Error when `name` is already registered.
 * @typeParam TState - The JSON-serialisable state.
 * @typeParam TOperations - The operations map.
 */
export function defineEntity<TState, const TOperations extends EntityOperations<TState>> (
  name: string,
  definition: { initialState: () => TState, operations: TOperations },
): TypedEntity<TState, TOperations> {
  claimName('entity', name)
  const { initialState, operations } = definition
  const handler = (context: EntityContext<TState>): void => {
    const operation = context.df.operationName
    const run = operation === undefined ? undefined : (operations as EntityOperations<TState>)[operation]
    if (run === undefined) {
      throw new Error(
        `Entity '${name}' has no operation '${String(operation)}'. It has: ${Object.keys(operations).join(', ')}.`,
      )
    }
    const state = context.df.getState(initialState) as TState
    const outcome = (run as (s: TState, i: unknown) => EntityOutcome<TState, unknown>)(state, context.df.getInput())
    context.df.setState(outcome.state)
    if (outcome.result !== undefined) {
      context.df.return(outcome.result)
    }
    if (outcome.destroy === true) {
      context.df.destructOnExit()
    }
  }
  df.app.entity<TState>(name, handler)

  return { name, initialState, operations, handler }
}

/**
 * Schedules an entity operation and waits for its result, without yielding it, for fan-out.
 *
 * @remarks
 * The task form of `callEntity`, for `all` and `any`.
 *
 * @param context - The orchestration context.
 * @param entity - The entity.
 * @param key - Which instance of the entity.
 * @param operation - The operation name, one the entity has.
 * @param input - The input, checked against the operation's declared type.
 * @returns A task carrying the operation's result type.
 * @throws Never - scheduling only.
 * @typeParam TState - The entity's state type.
 * @typeParam TOperations - The entity's operations.
 * @typeParam TName - The operation name.
 */
export function entityTask<TState, TOperations extends EntityOperations<TState>, TName extends keyof TOperations & string> (
  context: OrchestrationContext,
  entity: TypedEntity<TState, TOperations>,
  key: string,
  operation: TName,
  input: EntityInput<TOperations, TName>,
): TypedTask<EntityResult<TOperations, TName>> {
  return { task: context.df.callEntity(new df.EntityId(entity.name, key), operation, input) }
}

/**
 * Calls an entity operation and returns its typed result.
 *
 * @remarks
 * **Must be invoked with `yield *`**, for the same reason as `callActivity`.
 *
 * @param context - The orchestration context.
 * @param entity - The entity.
 * @param key - Which instance of the entity.
 * @param operation - The operation name, one the entity has.
 * @param input - The input, checked against the operation's declared type.
 * @returns A generator to delegate to; its return value is the operation's result.
 * @throws Whatever the entity operation threw, once the driver resumes with a failure.
 * @typeParam TState - The entity's state type.
 * @typeParam TOperations - The entity's operations.
 * @typeParam TName - The operation name.
 */
export function * callEntity<TState, TOperations extends EntityOperations<TState>, TName extends keyof TOperations & string> (
  context: OrchestrationContext,
  entity: TypedEntity<TState, TOperations>,
  key: string,
  operation: TName,
  input: EntityInput<TOperations, TName>,
): Generator<Task, EntityResult<TOperations, TName>, unknown> {
  const result = yield entityTask(context, entity, key, operation, input).task

  return result as EntityResult<TOperations, TName>
}

/**
 * Sends an operation to an entity from an orchestration and does not wait for it.
 *
 * @remarks
 * Recorded with the orchestration's other actions, so it replays deterministically.
 *
 * @param context - The orchestration context.
 * @param entity - The entity.
 * @param key - Which instance of the entity.
 * @param operation - The operation name, one the entity has.
 * @param input - The input, checked against the operation's declared type.
 * @returns Nothing.
 * @throws Never - the signal is enqueued with the orchestration's other actions.
 * @typeParam TState - The entity's state type.
 * @typeParam TOperations - The entity's operations.
 * @typeParam TName - The operation name.
 */
export function signalEntity<TState, TOperations extends EntityOperations<TState>, TName extends keyof TOperations & string> (
  context: OrchestrationContext,
  entity: TypedEntity<TState, TOperations>,
  key: string,
  operation: TName,
  input: EntityInput<TOperations, TName>,
): void {
  context.df.signalEntity(new df.EntityId(entity.name, key), operation, input)
}

/**
 * Sends an operation to an entity from a client (an HTTP or queue trigger) and does not wait for it.
 *
 * @remarks
 * The client half of `signalEntity`.
 *
 * @param client - The Durable client.
 * @param entity - The entity.
 * @param key - Which instance of the entity.
 * @param operation - The operation name, one the entity has.
 * @param input - The input, checked against the operation's declared type.
 * @returns A promise resolving when the signal is enqueued.
 * @throws Propagates whatever the client throws.
 * @typeParam TState - The entity's state type.
 * @typeParam TOperations - The entity's operations.
 * @typeParam TName - The operation name.
 */
export async function signalEntityFromClient<TState, TOperations extends EntityOperations<TState>, TName extends keyof TOperations & string> (
  client: DurableClient,
  entity: TypedEntity<TState, TOperations>,
  key: string,
  operation: TName,
  input: EntityInput<TOperations, TName>,
): Promise<void> {
  await client.signalEntity(new df.EntityId(entity.name, key), operation, input)
}

/**
 * Reads an entity's current state from a client.
 *
 * @remarks
 * Reads the stored state, not the result of an operation; an entity that was never signalled does not exist.
 *
 * @param client - The Durable client.
 * @param entity - The entity.
 * @param key - Which instance of the entity.
 * @returns The state, or `undefined` when that key has no entity.
 * @throws Propagates whatever the client throws.
 * @typeParam TState - The entity's state type.
 * @typeParam TOperations - The entity's operations.
 */
export async function readEntityState<TState, TOperations extends EntityOperations<TState>> (
  client: DurableClient,
  entity: TypedEntity<TState, TOperations>,
  key: string,
): Promise<TState | undefined> {
  const response = await client.readEntityState<TState>(new df.EntityId(entity.name, key))

  return response.entityExists ? response.entityState : undefined
}
