import { greeting } from './greeting.js'

process.stdout.write(`${greeting(process.argv[2] ?? 'world')}\n`)
