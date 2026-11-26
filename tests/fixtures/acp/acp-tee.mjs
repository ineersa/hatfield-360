// Runs an ACP agent on stdio and copies every JSON-RPC message, both directions, to a log file.
// Used by `pnpm record:chat-cassettes`: node acp-tee.mjs <log.jsonl> <agent-script>
import { spawn } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const [log, script] = process.argv.slice(2)
if (!log || !script) throw new Error('usage: acp-tee.mjs <log.jsonl> <agent-script>')
writeFileSync(log, '')

const agent = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'inherit'] })
const record = (from, line) => {
  if (line.trim() === '') return
  appendFileSync(log, `${JSON.stringify({ from, message: JSON.parse(line) })}\n`)
}

createInterface({ input: process.stdin }).on('line', (line) => {
  record('client', line)
  agent.stdin.write(`${line}\n`)
})
createInterface({ input: agent.stdout }).on('line', (line) => {
  record('agent', line)
  process.stdout.write(`${line}\n`)
})
process.stdin.on('end', () => agent.stdin.end())
process.on('SIGTERM', () => agent.kill())
agent.on('exit', (code) => process.exit(code ?? 0))
