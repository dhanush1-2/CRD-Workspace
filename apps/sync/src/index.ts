import { loadConfig } from './config.js'
import { createSyncServer } from './server.js'

const config = loadConfig()

const server = await createSyncServer({
  port: config.port,
  jwtSecret: config.jwtSecret,
  idleEvictMs: config.idleEvictMs,
})

console.log(JSON.stringify({ level: 'info', msg: 'sync server listening', port: server.port }))

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0))
  })
}
