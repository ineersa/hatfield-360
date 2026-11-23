import { randomUUID } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { createInterface } from 'node:readline'

let {
  H360_STATUS_ENDPOINT: path,
  H360_STATUS_TOKEN: token,
  H360_STATUS_LAUNCH_ID: launchId
} = process.env
const [provider = 'hatfield', sessionId = 'demo', marker = 'demo'] = process.argv.slice(2)
let sequence = 0
let last
let initial
const snapshot = {
  provider,
  turn: null,
  attention: null,
  activeSubagents: 0,
  backgroundScripts: provider === 'hatfield' ? 0 : null,
  tool: null
}
const print = (message) => process.stdout.write(`${message}\n`)
const send = (event) =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ path }, () => socket.write(`${JSON.stringify(event)}\n`))
    let buffer = ''
    socket.setTimeout(1000, () => socket.destroy(new Error('No status reply')))
    socket.setEncoding('utf8')
    socket.on('error', reject)
    socket.on('end', () => reject(new Error('Incomplete status reply')))
    socket.on('data', (chunk) => {
      buffer += chunk
      if (!buffer.includes('\n')) return
      socket.destroy()
      try {
        const reply = JSON.parse(buffer.split('\n')[0])
        if (reply.ok) resolve(reply)
        else reject(new Error(`Status rejected: ${reply.error}`))
      } catch (error) {
        reject(error)
      }
    })
  })
const bootstrapToken = process.env.H360_STATUS_BOOTSTRAP_TOKEN
if (token === undefined && launchId === undefined && path && bootstrapToken) {
  const [processStat, namespace] = await Promise.all([
    readFile('/proc/self/stat', 'utf8'),
    stat('/proc/self/ns/pid', { bigint: true })
  ])
  const reply = await send({
    version: 1,
    kind: 'launch.register',
    bootstrapToken,
    instanceId: randomUUID(),
    provider,
    owner: {
      pid: process.pid,
      pidNamespace: namespace.ino.toString(),
      startTicks: processStat.slice(processStat.lastIndexOf(') ') + 2).split(' ')[19]
    }
  })
  ;({ token, launchId } = reply)
}
if (!path || !token || !launchId) {
  console.error('This demo requires Hatfield 360 reporting credentials.')
  process.exit(1)
}
const sendEvent = async (event) => (await send(event)).status
async function emit(kind, fields = {}) {
  sequence++
  last = {
    version: 1,
    token,
    launchId,
    sessionId,
    sessionEpoch: 1,
    eventId: `event-${sequence}`,
    sequence,
    kind,
    ...fields
  }
  return sendEvent(last)
}

const report = () => emit('session.snapshot', snapshot)

print(`Scenario ready: ${marker}`)
print(`Directory: ${process.cwd()}`)
const input = createInterface({ input: process.stdin, terminal: false })
for await (const command of input) {
  try {
    let reply
    switch (command) {
      case 'start':
      case 'again':
        snapshot.turn = { id: `turn-${sequence + 1}`, status: 'working' }
        snapshot.attention = null
        snapshot.tool = null
        reply = await report()
        if (command === 'start') initial = last
        break
      case 'end-reporting':
        reply = await emit('session.ended')
        break
      case 'tool':
        snapshot.tool = 'Read'
        reply = await report()
        break
      case 'wait':
        snapshot.attention = { id: `input-${sequence + 1}`, reason: 'permission' }
        reply = await report()
        break
      case 'resolve':
        snapshot.attention = null
        reply = await report()
        break
      case 'script':
      case 'script-done':
        snapshot.backgroundScripts = command === 'script' ? 1 : 0
        reply = await report()
        break
      case 'report-failure-on-hangup':
        process.once('SIGHUP', () => {
          snapshot.turn = { ...snapshot.turn, status: 'failed' }
          void report()
            .then((status) => writeFile(join(process.cwd(), 'hangup-report'), status))
            .then(
              () => process.exit(0),
              (error) => {
                console.error(error)
                process.exit(1)
              }
            )
        })
        reply = 'armed'
        break
      case 'child-working':
      case 'child':
        snapshot.activeSubagents = 1
        if (command === 'child')
          snapshot.attention = { id: `input-${sequence + 1}`, reason: 'question' }
        reply = await report()
        break
      case 'children-unknown':
      case 'child-done':
        snapshot.activeSubagents = command === 'child-done' ? 0 : null
        if (snapshot.attention?.reason === 'question') snapshot.attention = null
        reply = await report()
        break
      case 'completed':
      case 'failed':
      case 'cancelled':
        snapshot.turn = { ...snapshot.turn, status: command }
        snapshot.tool = null
        reply = await report()
        break
      case 'message':
        reply = await emit('notification', {
          title: 'Review available',
          body: 'The report is ready.'
        })
        break
      case 'duplicate':
        reply = await sendEvent(last)
        break
      case 'stale':
        reply = await sendEvent({ ...initial, eventId: 'delayed-start' })
        break
      case 'quit':
        input.close()
        break
      default:
        print(
          'Commands: start, again, tool, wait, resolve, child, child-working, children-unknown, child-done, completed, failed, cancelled, message, duplicate, stale, report-failure-on-hangup, quit'
        )
    }
    if (reply) print(`ACK ${command}: ${reply}`)
  } catch {
    print(`Scenario command failed: ${command}`)
  }
  if (command === 'quit') break
}
process.stdin.pause()
