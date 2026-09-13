// Author/creator: nattapat2871 (https://nattapat2871.me)
/** Retry-After is a minimum, not a delay to shorten to our retry budget. */
export const retryAfterMilliseconds = (value: unknown, fallback: number, now = Date.now()) => {
  const raw = String(value ?? '').trim()
  if (!raw) return fallback
  const seconds = Number(raw)
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - now
  return Number.isFinite(delay) && delay >= 0 ? Math.max(1000, Math.ceil(delay)) : fallback
}

/** Bounded concurrency with a shared cooldown so background scans cannot retry in a storm. */
export class ProviderRequestGate {
  private active = 0
  private queue: Array<{ enter: () => void }> = []
  private blockedUntil = 0
  private lastRateError: unknown

  private readonly concurrency: number
  private readonly now: () => number

  constructor(concurrency = 3, now = Date.now) {
    this.concurrency = Math.max(1, Math.min(16, Math.floor(concurrency) || 1))
    this.now = now
  }

  defer(milliseconds: number, error: unknown) {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + milliseconds)
    this.lastRateError = error
  }

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const cancelled = () => Object.assign(new Error('Provider request canceled'), { name: 'AbortError' })
    if (signal?.aborted) throw cancelled()
    if (this.now() < this.blockedUntil) throw this.lastRateError
    if (this.active >= this.concurrency) {
      if (this.queue.length >= 250) throw new Error('Too many pending provider requests. Please wait and try again.')
      await new Promise<void>((resolve, reject) => {
        const entry = { enter: () => { signal?.removeEventListener('abort', abort); resolve() } }
        const abort = () => {
          const index = this.queue.indexOf(entry)
          if (index >= 0) this.queue.splice(index, 1)
          signal?.removeEventListener('abort', abort)
          reject(cancelled())
        }
        this.queue.push(entry)
        signal?.addEventListener('abort', abort, { once: true })
      })
    } else this.active += 1
    try {
      if (signal?.aborted) throw cancelled()
      if (this.now() < this.blockedUntil) throw this.lastRateError
      return await operation()
    } finally {
      const next = this.queue.shift()
      if (next) next.enter()
      else this.active -= 1
    }
  }
}
