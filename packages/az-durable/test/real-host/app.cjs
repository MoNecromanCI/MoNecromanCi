/* eslint-disable -- a manual harness run by hand against a real Functions host, not shipped code (see README.md) */
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('@azure/functions')
const df = require('durable-functions')
const az = require('@mnci/az-durable')

const LOG = path.join(__dirname, 'calls.log')
const record = (line) => fs.appendFileSync(LOG, line + '\n')

// ---- activities (each execution is logged, so replay can be counted) ----
const step = az.defineActivity('Step', (input) => {
  record(`Step:${input.label}`)

  return `${input.label}-done`
})
const boom = az.defineActivity('Boom', (input) => { record(`Boom:${input.label}`); throw new Error(`boom ${input.label}`) })

// ---- 1. replay: three activities, a timer-free orchestration; Step must run exactly once each ----
const replay = az.defineOrchestration('Replay', function * (context, input) {
  const started = az.now(context).toISOString()
  const a = yield * az.callActivity(context, step, { label: 'a' })
  const b = yield * az.callActivity(context, step, { label: 'b' })
  const c = yield * az.callActivity(context, step, { label: 'c' })

  return { started, results: [a, b, c], finished: az.now(context).toISOString() }
})

// ---- 2. retry exhaustion ----
const exhaust = az.defineOrchestration('Exhaust', function * (context) {
  try {
    yield * az.callActivity(context, boom, { label: 'x' }, az.retryPolicy({ firstRetryIntervalInMilliseconds: 1000, maxNumberOfAttempts: 3 }))

    return { caught: false }
  } catch (error) {
    return { caught: true, message: error instanceof Error ? error.message : String(error) }
  }
})

// ---- 3. event or timeout ----
const approved = az.defineEvent('Approved')
const approval = az.defineOrchestration('Approval', function * (context) {
  const eventTask = az.eventTask(context, approved)
  const timeout = az.timerTask(context, 6000)
  const winner = yield * az.any(context, [eventTask, timeout])
  if (winner === eventTask) {
    timeout.cancel()

    return { outcome: 'approved', payload: az.resultOf(eventTask) }
  }

  return { outcome: 'timeout' }
})

// ---- 4. timer ----
const timer = az.defineOrchestration('Timer', function * (context) {
  const before = az.now(context).getTime()
  yield * az.sleepFor(context, 4000)
  const after = az.now(context).getTime()

  return { elapsedMs: after - before }
})

// ---- 5. sub-orchestrations ----
const child = az.defineOrchestration('Child', function * (context, input) {
  const r = yield * az.callActivity(context, step, { label: `child-${input.n}` })
  if (input.fail) throw new Error(`child ${input.n} failed`)

  return r
})
const parent = az.defineOrchestration('Parent', function * (context) {
  const one = yield * az.callSubOrchestration(context, child, { n: 1, fail: false })
  let two
  try { two = yield * az.callSubOrchestration(context, child, { n: 2, fail: true }) } catch (error) { two = `caught: ${error instanceof Error ? error.message : String(error)}` }

  return { one, two }
})

// ---- 6. continueAsNew ----
const looping = az.defineOrchestration('Looping', function * (context, input, self) {
  yield * az.callActivity(context, step, { label: `loop-${input.n}` })
  if (input.n < 3) {
    self.continueAsNew({ n: input.n + 1 })

    return
  }

  return { finishedAt: input.n }
})

// ---- 7. parse ----
const parsed = az.defineOrchestration('Parsed', function * (context, input) { return `hello ${input.name}` }, {
  parse: (raw) => {
    if (typeof raw !== 'object' || raw === null || typeof raw.name !== 'string') throw new Error('bad input')

    return raw
  },
})

// ---- 8. entities ----
const counter = az.defineEntity('Counter', {
  initialState: () => 0,
  operations:   {
    add:  (state, amount) => ({ state: state + amount, result: state + amount }),
    stop: (state) => ({ state, result: 'stopped', destroy: true }),
  },
})
const tally = az.defineOrchestration('Tally', function * (context, input) {
  az.signalEntity(context, counter, input.key, 'add', 5)
  const total = yield * az.callEntity(context, counter, input.key, 'add', 2)

  return { total }
})

const ORCHESTRATIONS = { replay, exhaust, approval, timer, parent, looping, parsed, tally }

app.http('start', {
  route:       'start/{name}',
  methods:     ['POST'],
  extraInputs: [df.input.durableClient()],
  handler:     async (request, context) => {
    const client = df.getClient(context)
    const orchestration = ORCHESTRATIONS[request.params.name]
    const body = request.headers.get('content-type')?.includes('json') ? await request.json() : undefined
    const id = await az.startOrchestration(client, orchestration, body ?? {}, { instanceId: `${request.params.name}-${Date.now()}` })

    return { jsonBody: { id } }
  },
})
app.http('event', {
  route:       'event/{id}',
  methods:     ['POST'],
  extraInputs: [df.input.durableClient()],
  handler:     async (request, context) => {
    await az.raiseEvent(df.getClient(context), request.params.id, approved, await request.json())

    return { status: 202 }
  },
})
app.http('status', {
  route:       'status/{id}',
  methods:     ['GET'],
  extraInputs: [df.input.durableClient()],
  handler:     async (request, context) => {
    const s = await df.getClient(context).getStatus(request.params.id, { showHistory: false })

    return { jsonBody: { runtimeStatus: s?.runtimeStatus, output: s?.output, createdTime: s?.createdTime, lastUpdatedTime: s?.lastUpdatedTime } }
  },
})
app.http('signal', {
  route:       'signal/{key}/{operation}',
  methods:     ['POST'],
  extraInputs: [df.input.durableClient()],
  handler:     async (request, context) => {
    await az.signalEntityFromClient(df.getClient(context), counter, request.params.key, request.params.operation, await request.json())

    return { status: 202 }
  },
})
app.http('counterState', {
  route:       'counter/{key}',
  methods:     ['GET'],
  extraInputs: [df.input.durableClient()],
  handler:     async (request, context) => ({ jsonBody: { state: (await az.readEntityState(df.getClient(context), counter, request.params.key)) ?? null } }),
})
