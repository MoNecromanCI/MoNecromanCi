import { defineEntity, callEntity, signalEntity } from './entity.js'
import { defineOrchestration } from './orchestration.js'
import { resetRegistryForTests } from './registry.js'
import { runEntity, runWorkflow } from './testing.js'

/** Builds the counter fresh, so the name registry stays clean per test. */
function buildCounter () {
  resetRegistryForTests()

  return defineEntity('counter', {
    initialState: () => 0,
    operations:   {
      add:   (state: number, amount: number) => ({ state: state + amount, result: state + amount }),
      reset: (_state: number, _input: undefined) => ({ state: 0 }),
      stop:  (state: number, _input: undefined) => ({ state, result: 'stopped', destroy: true }),
    },
  })
}

describe('defineEntity and runEntity', () => {
  it('starts from the initial state and threads state through the operations', () => {
    const counter = buildCounter()
    const run = runEntity(counter, [
      { operation: 'add', input: 2 },
      { operation: 'add', input: 3 },
    ])

    expect(run.state).toBe(5)
    expect(run.results).toEqual([2, 5])
  })

  it('stores the state of an operation that returns no result', () => {
    const counter = buildCounter()
    const run = runEntity(counter, [{ operation: 'add', input: 4 }, { operation: 'reset' }])

    expect(run.state).toBe(0)
    expect(run.results).toEqual([4, undefined])
  })

  it('starts from a given state when one is passed', () => {
    const counter = buildCounter()

    expect(runEntity(counter, [{ operation: 'add', input: 1 }], 10).state).toBe(11)
  })

  it('reports an entity deleted by an operation and stops there', () => {
    const counter = buildCounter()
    const run = runEntity(counter, [{ operation: 'stop' }, { operation: 'add', input: 1 }])

    expect(run.destroyed).toBe(true)
    expect(run.state).toBeUndefined()
    expect(run.results).toEqual(['stopped'])
  })

  it('names the operations the entity has when asked for one it does not', () => {
    const counter = buildCounter()

    expect(() => runEntity(counter, [{ operation: 'subtract', input: 1 }])).toThrow(
      "Entity 'counter' has no operation 'subtract'. It has: add, reset, stop.",
    )
  })

  it('refuses a second entity with the same name', () => {
    buildCounter()

    expect(() => defineEntity('counter', { initialState: () => 0, operations: {} })).toThrow(/Duplicate entity name 'counter'/)
  })
})

describe('callEntity and signalEntity in an orchestration', () => {
  it('returns the operation result typed, and records the call with its key', () => {
    const counter = buildCounter()
    const orchestration = defineOrchestration('tally', function * (context, input: { by: number }) {
      signalEntity(context, counter, 'visits', 'reset', undefined)
      const total = yield * callEntity(context, counter, 'visits', 'add', input.by)

      return { total }
    })
    const run = runWorkflow(orchestration, { by: 7 }, {
      activities: {},
      entities:   { 'counter.add': (input, key) => (key === 'visits' ? (input as number) + 100 : 0) },
    })

    expect(run.result).toEqual({ total: 107 })
    expect(run.calls).toEqual([
      { name: 'counter.reset', input: undefined, entityKey: 'visits', signal: true },
      { name: 'counter.add', input: 7, entityKey: 'visits' },
    ])
  })

  it('throws inside the orchestration when the stub returns an Error', () => {
    const counter = buildCounter()
    const orchestration = defineOrchestration('guarded', function * (context, _input: undefined) {
      try {
        yield * callEntity(context, counter, 'k', 'add', 1)

        return 'ok'
      } catch {
        return 'failed'
      }
    })

    expect(runWorkflow(orchestration, undefined, {
      activities: {},
      entities:   { 'counter.add': () => new Error('boom') },
    }).result).toBe('failed')
  })

  it('names the entity operation that has no stub', () => {
    const counter = buildCounter()
    const orchestration = defineOrchestration('unstubbed', function * (context, _input: undefined) {
      return yield * callEntity(context, counter, 'k', 'add', 1)
    })

    expect(() => runWorkflow(orchestration, undefined, { activities: {} })).toThrow(/entity operation 'counter\.add'/)
  })

  it('rejects an unknown operation and a wrong input at compile time', () => {
    const counter = buildCounter()
    defineOrchestration('typed', function * (context, _input: undefined) {
      // @ts-expect-error - no such operation
      yield * callEntity(context, counter, 'k', 'subtract', 1)
      // @ts-expect-error - add takes a number
      yield * callEntity(context, counter, 'k', 'add', 'one')
      const total: number = yield * callEntity(context, counter, 'k', 'add', 1)

      return total
    })
  })
})
