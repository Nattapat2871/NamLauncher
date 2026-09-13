// Author/creator: nattapat2871 (https://nattapat2871.me)

export type GameSessionEventName = 'start' | 'heartbeat' | 'end'
export type GameSessionEndReason =
  | 'game-exit'
  | 'user-stop'
  | 'launcher-exit'
  | 'telemetry-disabled'
  | 'unknown'

export const GAME_SESSION_HEARTBEAT_INTERVAL_MS = 45_000

export const normalizeGameSessionLoader = (value: unknown) => {
  const loader = String(value || '').trim().toLowerCase()
  return ['vanilla', 'fabric', 'forge', 'quilt', 'neoforge'].includes(loader)
    ? loader as 'vanilla' | 'fabric' | 'forge' | 'quilt' | 'neoforge'
    : 'unknown'
}

export const getGameSessionEndReason = (stopRequested: boolean): GameSessionEndReason => (
  stopRequested ? 'user-stop' : 'game-exit'
)
