// Stands in for the ACP adapter: answers the client with a recorded cassette, in order, without delays.
// The app runs it in place of the adapter when HATFIELD_CHAT_AGENT_SCRIPT points here; the cassette
// is HATFIELD_CHAT_CASSETTE. Each client message must match the recording; one that doesn't stops
// the replay with a diff on stderr, which the chat shows as the agent's error.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { Bindings, parseCassette } from './cassette.mjs'

const file = process.env.HATFIELD_CHAT_CASSETTE
if (!file) throw new Error('HATFIELD_CHAT_CASSETTE is not set')
const { entries } = parseCassette(readFileSync(file, 'utf8'))
const bindings = new Bindings({ '<home>': homedir() })

let next = 0
/** The recorded client messages expected before the next agent message, in any order. */
let expected = []

function advance() {
  for (;;) {
    if (expected.length > 0) return
    const entry = entries[next]
    if (!entry) return
    if (entry.from === 'client') {
      while (entries[next]?.from === 'client') expected.push(entries[next++].message)
      return
    }
    next += 1
    process.stdout.write(`${JSON.stringify(bindings.fill(entry.message))}\n`)
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return
  const actual = JSON.parse(line)
  // Past the end of the recording, what the client still says (closing the session) is ignored.
  if (expected.length === 0 && next >= entries.length) return
  const index = expected.findIndex((recorded) => bindings.match(recorded, actual))
  if (index < 0) {
    process.stderr.write(
      `Cassette ${file} doesn't match the client.\nExpected one of:\n${expected
        .map((message) => JSON.stringify(message))
        .join('\n')}\nGot:\n${line}\n`
    )
    process.exit(1)
  }
  expected.splice(index, 1)
  advance()
})
process.stdin.on('end', () => process.exit(0))
advance()
