#!/usr/bin/env node
// Author/creator: nattapat2871 (https://nattapat2871.me)

import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_PORT = 9327
const TARGET_PATH_SUFFIX = '/dist/index.html'
const MAX_RESPONSE_BYTES = 256 * 1024
const CONNECT_TIMEOUT_MS = 10_000
const MIN_QA_WIDTH = 1280
const MIN_QA_HEIGHT = 720
const MAX_QA_DIMENSION = 7680

const parsePort = (rawValue) => {
  const value = Number(rawValue || DEFAULT_PORT)
  if (!Number.isInteger(value) || value < 1024 || value > 65_535) {
    throw new Error('NAMLAUNCHER_QA_CDP_PORT must be an integer from 1024 to 65535.')
  }
  return value
}

const getQaRoot = () => {
  const rawRoot = String(process.env.NAMLAUNCHER_QA_ROOT || '').trim()
  if (!rawRoot || !path.isAbsolute(rawRoot)) {
    throw new Error('NAMLAUNCHER_QA_ROOT must be an absolute disposable QA directory.')
  }
  return path.resolve(rawRoot)
}

const resolveQaOutputPath = (qaRoot, relativePath) => {
  const rawPath = String(relativePath || '').trim()
  if (!rawPath || path.isAbsolute(rawPath)) {
    throw new Error('Screenshot output must be a relative path inside NAMLAUNCHER_QA_ROOT.')
  }

  const outputPath = path.resolve(qaRoot, rawPath)
  const relative = path.relative(qaRoot, outputPath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Screenshot output escaped NAMLAUNCHER_QA_ROOT.')
  }
  return outputPath
}

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`DevTools endpoint returned HTTP ${response.status}.`)

  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error('DevTools endpoint returned an oversized response.')
  }
  return JSON.parse(text)
}

const getPageTarget = async (port) => {
  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`)
  if (!Array.isArray(targets)) throw new Error('DevTools target list was not an array.')

  const target = targets.find((candidate) => {
    if (candidate?.type !== 'page' || typeof candidate.url !== 'string') return false
    try {
      const parsed = new URL(candidate.url)
      return parsed.protocol === 'file:' && parsed.pathname.endsWith(TARGET_PATH_SUFFIX)
    } catch {
      return false
    }
  })
  if (!target || typeof target.webSocketDebuggerUrl !== 'string') {
    throw new Error('Could not find the isolated NamLauncher renderer target.')
  }
  return target
}

const connectCdp = (webSocketUrl) => new Promise((resolve, reject) => {
  if (typeof WebSocket !== 'function') {
    reject(new Error('This QA helper requires a Node.js runtime with global WebSocket support.'))
    return
  }

  const socket = new WebSocket(webSocketUrl)
  const pending = new Map()
  let sequence = 0
  let settled = false

  const closeWithError = (error) => {
    if (settled) return
    settled = true
    socket.close()
    reject(error instanceof Error ? error : new Error(String(error)))
  }

  const timeout = setTimeout(() => {
    closeWithError(new Error('Timed out while connecting to the isolated renderer.'))
  }, CONNECT_TIMEOUT_MS)

  socket.addEventListener('message', (event) => {
    let message
    try {
      message = JSON.parse(String(event.data))
    } catch {
      closeWithError(new Error('DevTools returned malformed JSON.'))
      return
    }
    if (!message.id || !pending.has(message.id)) return

    const callback = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) callback.reject(new Error(String(message.error.message || 'DevTools command failed.')))
    else callback.resolve(message.result)
  })

  socket.addEventListener('error', () => {
    closeWithError(new Error('Could not connect to the isolated renderer.'))
  })

  socket.addEventListener('open', () => {
    clearTimeout(timeout)
    if (settled) return
    settled = true
    resolve({
      call(method, params = {}) {
        return new Promise((commandResolve, commandReject) => {
          const id = ++sequence
          pending.set(id, { resolve: commandResolve, reject: commandReject })
          socket.send(JSON.stringify({ id, method, params }))
        })
      },
      close() {
        socket.close()
      }
    })
  })
})

const evaluate = async (client) => {
  const encodedExpression = String(process.env.NAMLAUNCHER_QA_EXPRESSION_B64 || '').trim()
  if (!encodedExpression || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedExpression)) {
    throw new Error('NAMLAUNCHER_QA_EXPRESSION_B64 must contain a Base64-encoded expression.')
  }

  const expression = Buffer.from(encodedExpression, 'base64').toString('utf8')
  if (!expression || Buffer.byteLength(expression, 'utf8') > 64 * 1024) {
    throw new Error('QA expression is empty or exceeds 64 KiB.')
  }

  await client.call('Runtime.enable')
  const result = await client.call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'QA expression failed.')
  }
  process.stdout.write(`${JSON.stringify(result.result?.value ?? result.result?.description ?? null, null, 2)}\n`)
}

const captureScreenshot = async (client, qaRoot) => {
  const outputPath = resolveQaOutputPath(qaRoot, process.env.NAMLAUNCHER_QA_SCREENSHOT)
  await client.call('Page.enable')
  const result = await client.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  })
  if (typeof result.data !== 'string' || result.data.length > 16 * 1024 * 1024) {
    throw new Error('DevTools returned an invalid or oversized screenshot.')
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'), { flag: 'wx' })
  process.stdout.write(`${outputPath}\n`)
}

const parseDimension = (name, minimum) => {
  const value = Number(process.env[name])
  if (!Number.isInteger(value) || value < minimum || value > MAX_QA_DIMENSION) {
    throw new Error(`${name} must be an integer from ${minimum} to ${MAX_QA_DIMENSION}.`)
  }
  return value
}

const resizeWindow = async (client) => {
  const width = parseDimension('NAMLAUNCHER_QA_WIDTH', MIN_QA_WIDTH)
  const height = parseDimension('NAMLAUNCHER_QA_HEIGHT', MIN_QA_HEIGHT)
  await client.call('Runtime.enable')
  const result = await client.call('Runtime.evaluate', {
    expression: `window.resizeTo(${width}, ${height})`,
    returnByValue: true,
    userGesture: true
  })
  if (result.exceptionDetails) throw new Error('The isolated renderer could not resize its window.')
  process.stdout.write(`${JSON.stringify({ width, height })}\n`)
}

const main = async () => {
  const mode = process.argv[2]
  if (!['evaluate', 'screenshot', 'resize'].includes(mode)) {
    throw new Error('Usage: node scripts/qa-electron-cdp.mjs <evaluate|screenshot|resize>')
  }

  const port = parsePort(process.env.NAMLAUNCHER_QA_CDP_PORT)
  const qaRoot = getQaRoot()
  const target = await getPageTarget(port)
  const client = await connectCdp(target.webSocketDebuggerUrl)
  try {
    if (mode === 'evaluate') await evaluate(client)
    else if (mode === 'screenshot') await captureScreenshot(client, qaRoot)
    else await resizeWindow(client)
  } finally {
    client.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
