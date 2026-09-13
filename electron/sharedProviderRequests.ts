// Author/creator: nattapat2871 (https://nattapat2871.me)
type Pending = {
  controller: AbortController
  promise: Promise<unknown>
  subscribers: number
  settled: boolean
}

const cancelled = () => Object.assign(new Error('Provider request canceled'), { name: 'AbortError' })

/** Only coalesce active GETs; never retain a stale file URL or download permission. */
export class SharedProviderRequests {
  private pending = new Map<string, Pending>()

  run<T>(key: string, operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(cancelled())
    let entry = this.pending.get(key)
    if (entry?.controller.signal.aborted) entry = undefined
    if (!entry) {
      if (this.pending.size >= 256) return Promise.reject(new Error('Too many pending provider requests. Please wait and try again.'))
      const created: Pending = { controller: new AbortController(), promise: Promise.resolve(), subscribers: 0, settled: false }
      created.promise = Promise.resolve().then(() => {
        if (created.controller.signal.aborted) throw cancelled()
        return operation(created.controller.signal)
      }).finally(() => {
        created.settled = true
        if (this.pending.get(key) === created) this.pending.delete(key)
      })
      entry = created
      this.pending.set(key, entry)
    }
    const shared = entry
    shared.subscribers += 1
    return new Promise<T>((resolve, reject) => {
      let completed = false
      const finish = (action: () => void) => {
        if (completed) return
        completed = true
        signal?.removeEventListener('abort', abort)
        shared.subscribers -= 1
        if (!shared.settled && shared.subscribers === 0) {
          if (this.pending.get(key) === shared) this.pending.delete(key)
          shared.controller.abort()
        }
        action()
      }
      const abort = () => finish(() => reject(cancelled()))
      signal?.addEventListener('abort', abort, { once: true })
      shared.promise.then(value => finish(() => resolve(value as T)), error => finish(() => reject(error)))
    })
  }
}
