import { createConnection } from 'node:net'
import { createInterface } from 'node:readline'

const {
  H360_STATUS_ENDPOINT: path,
  H360_STATUS_TOKEN: token,
  H360_STATUS_LAUNCH_ID: launchId
} = process.env
const [provider = 'hatfield', sessionId = 'demo', marker = 'demo'] = process.argv.slice(2)
if (!path || !token || !launchId) {
  console.error('This demo must be launched as an agent from Hatfield 360.')
  process.exit(1)
}
let sequence = 0
let last
let turn
let waitStart
let childTurn
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
        if (reply.ok) resolve(reply.status)
        else reject(new Error(`Status rejected: ${reply.error}`))
      } catch (error) {
        reject(error)
      }
    })
  })
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
  return send(last)
}

print(`Scenario ready: ${marker}`)
print(`Directory: ${process.cwd()}`)
const input = createInterface({ input: process.stdin, terminal: false })
for await (const command of input) {
  try {
    let reply
    switch (command) {
      case 'start':
        await emit('session.started', { provider, capabilities: ['waits', 'actors'] })
        turn = { ...main, turnId: 'turn', turnStart: sequence + 1 }
        reply = await emit('turn.started', { ...main, turnId: turn.turnId })
        initial = last
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
      case 'child': {
        const actor = { actorId: 'child', actorStart: sequence + 1 }
        await emit('actor.started', { actorId: actor.actorId, parentId: 'main', parentStart: 1 })
        childTurn = { ...actor, turnId: 'child-turn', turnStart: sequence + 1 }
        await emit('turn.started', { ...actor, turnId: childTurn.turnId })
        reply = await emit('wait.started', { ...childTurn, waitId: 'question', reason: 'question' })
        break
      }
      case 'child-done':
        reply = await emit('actor.ended', {
          actorId: childTurn.actorId,
          actorStart: childTurn.actorStart
        })
        break
      case 'completed':
      case 'failed':
      case 'cancelled':
        reply = await emit('turn.ended', { ...turn, outcome: command })
        break
      case 'duplicate':
        reply = await send(last)
        break
      case 'stale':
        reply = await send({ ...initial, eventId: 'delayed-start' })
        break
      case 'quit':
        input.close()
        break
      default:
        print(
          'Commands: start, again, tool, wait, resolve, child, child-done, completed, failed, cancelled, duplicate, stale, quit'
        )
    }
    if (reply) print(`ACK ${command}: ${reply}`)
  } catch {
    print(`Scenario command failed: ${command}`)
  }
  if (command === 'quit') break
}
process.stdin.pause()
