// Author/creator: nattapat2871 (https://nattapat2871.me)

export const WINDOW_UNRESPONSIVE_GRACE_MS = 12_000

type TimerHandle = unknown

export class WindowResponsivenessMonitor {
  private readonly options: Readonly<{
    graceMs?: number
    now?: () => number
    schedule?: (callback: () => void, delayMs: number) => TimerHandle
    cancel?: (timer: TimerHandle) => void
    onPersistent: (durationMs: number) => Promise<void> | void
    onRecovered: (durationMs: number, reported: boolean) => void
    onReportError: (error: unknown) => void
  }>
  private startedAt: number | null = null
  private timer: TimerHandle | null = null
  private reported = false

  constructor(options: Readonly<{
    graceMs?: number
    now?: () => number
    schedule?: (callback: () => void, delayMs: number) => TimerHandle
    cancel?: (timer: TimerHandle) => void
    onPersistent: (durationMs: number) => Promise<void> | void
    onRecovered: (durationMs: number, reported: boolean) => void
    onReportError: (error: unknown) => void
  }>) {
    this.options = options
  }

  markUnresponsive() {
    if (this.startedAt !== null) return
    const now = this.options.now || Date.now
    const schedule = this.options.schedule || ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs))
    this.startedAt = now()
    const graceMs = this.options.graceMs ?? WINDOW_UNRESPONSIVE_GRACE_MS
    this.timer = schedule(() => {
      if (this.startedAt === null || this.reported) return
      this.timer = null
      this.reported = true
      Promise.resolve()
        .then(() => this.options.onPersistent(Math.max(graceMs, now() - this.startedAt!)))
        .catch(this.options.onReportError)
    }, graceMs)
  }

  markResponsive() {
    if (this.startedAt === null) return
    const durationMs = Math.max(0, (this.options.now || Date.now)() - this.startedAt)
    const wasReported = this.reported
    this.reset()
    this.options.onRecovered(durationMs, wasReported)
  }

  dispose() {
    this.reset()
  }

  private reset() {
    if (this.timer !== null) {
      const cancel = this.options.cancel
        || ((timer: TimerHandle) => clearTimeout(timer as ReturnType<typeof setTimeout>))
      cancel(this.timer)
    }
    this.timer = null
    this.startedAt = null
    this.reported = false
  }
}
