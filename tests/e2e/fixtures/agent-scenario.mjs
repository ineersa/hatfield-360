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
let turn
let waitStart
let childTurn
let scriptStart
let initial
const main = { actorId: 'main', actorStart: 1 }
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

print(`Scenario ready: ${marker}`)
print(`Directory: ${process.cwd()}`)
const input = createInterface({ input: process.stdin, terminal: false })
for await (const command of input) {
  try {
    let reply
    switch (command) {
      case 'start':
        await emit('session.started', {
          provider,
          capabilities: [
            'waits',
            'actors',
            'session-end',
            'notifications',
            ...(provider === 'hatfield' ? ['scripts'] : [])
          ]
        })
        turn = { ...main, turnId: 'turn', turnStart: sequence + 1 }
        reply = await emit('turn.started', { ...main, turnId: turn.turnId })
        initial = last
        break
      case 'end-reporting':
        reply = await emit('session.ended')
        break
      case 'again':
        turn = { ...main, turnId: 'turn', turnStart: sequence + 1 }
        reply = await emit('turn.started', { ...main, turnId: turn.turnId })
        break
      case 'tool':
        reply = await emit('activity.changed', { ...turn, activity: 'working', tool: 'Read' })
        break
      case 'wait':
        waitStart = sequence + 1
        reply = await emit('wait.started', { ...turn, waitId: 'permission', reason: 'permission' })
        break
      case 'resolve':
        reply = await emit('wait.resolved', { ...turn, waitId: 'permission', waitStart })
        break
      case 'script':
        scriptStart = sequence + 1
        reply = await emit('script.started', { scriptId: 'background' })
        break
      case 'script-done':
        reply = await emit('script.ended', { scriptId: 'background', scriptStart })
        break
      case 'report-failure-on-hangup':
        process.once('SIGHUP', () => {
          void emit('turn.ended', { ...turn, outcome: 'failed' })
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
      case 'child-start-only':
      case 'child-working':
      case 'child': {
        const actor = { actorId: 'child', actorStart: sequence + 1 }
        reply = await emit('actor.started', {
          actorId: actor.actorId,
          parentId: 'main',
          parentStart: 1
        })
        childTurn = { ...actor, turnId: 'child-turn', turnStart: sequence + 1 }
        if (command === 'child-start-only') break
        reply = await emit('turn.started', { ...actor, turnId: childTurn.turnId })
        if (command === 'child')
          reply = await emit('wait.started', {
            ...childTurn,
            waitId: 'question',
            reason: 'question'
          })
        break
      }
      case 'child-done':
        reply = await emit('actor.ended', {
          actorId: childTurn.actorId,
          actorStart: childTurn.actorStart
        })
        break
      case 'child-idle':
        reply = await emit('activity.changed', { ...childTurn, activity: 'idle' })
        break
      case 'child-turn-done':
        reply = await emit('turn.ended', { ...childTurn, outcome: 'completed' })
        break
      case 'completed':
      case 'failed':
      case 'cancelled':
        reply = await emit('turn.ended', { ...turn, outcome: command })
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
          'Commands: start, again, tool, wait, resolve, child, child-start-only, child-working, child-idle, child-turn-done, child-done, completed, failed, cancelled, message, duplicate, stale, report-failure-on-hangup, quit'
        )
    }
    if (reply) print(`ACK ${command}: ${reply}`)
  } catch {
    print(`Scenario command failed: ${command}`)
  }
  if (command === 'quit') break
}
process.stdin.pause()
