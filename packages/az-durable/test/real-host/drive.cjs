/* eslint-disable -- a manual harness run by hand against a real Functions host, not shipped code (see README.md) */
const fs = require('node:fs')
const BASE = 'http://localhost:7071/api'
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function start (name, body) {
  const r = await fetch(`${BASE}/start/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

  return (await r.json()).id
}
async function finish (id, timeoutMs = 90000) {
  const t0 = Date.now()
  for (;;) {
    const s = await (await fetch(`${BASE}/status/${id}`)).json()
    if (['Completed', 'Failed', 'Terminated'].includes(s.runtimeStatus)) return s
    if (Date.now() - t0 > timeoutMs) return { timedOut: true, ...s }
    await sleep(500)
  }
}
const calls = () => (fs.existsSync('calls.log') ? fs.readFileSync('calls.log', 'utf8').trim().split('\n') : [])
const count = (pattern) => calls().filter(l => l.startsWith(pattern)).length

async function main () {
  const out = {}

  fs.writeFileSync('calls.log', '')
  out.replay = await finish(await start('replay'))
  out.replay.stepRuns = calls().filter(l => l.startsWith('Step:')).join(',')

  fs.writeFileSync('calls.log', '')
  out.exhaust = await finish(await start('exhaust'))
  out.exhaust.boomRuns = count('Boom:')

  const a = await start('approval'); await sleep(1500)
  await fetch(`${BASE}/event/${a}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ by: 'edu' }) })
  out.approvalEvent = await finish(a)
  out.approvalTimeout = await finish(await start('approval'), 60000)

  out.timer = await finish(await start('timer'))

  fs.writeFileSync('calls.log', '')
  out.parent = await finish(await start('parent'))
  out.parent.stepRuns = calls().filter(l => l.startsWith('Step:')).join(',')

  fs.writeFileSync('calls.log', '')
  out.looping = await finish(await start('looping', { n: 1 }))
  out.looping.stepRuns = calls().filter(l => l.startsWith('Step:')).join(',')

  out.parsedOk = await finish(await start('parsed', { name: 'edu' }))
  out.parsedBad = await finish(await start('parsed', { nope: 1 }))

  console.log(JSON.stringify(out, null, 1))
}
main().catch(error => { console.error(error); process.exit(1) })
