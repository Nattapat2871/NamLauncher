// Author/creator: nattapat2871 (https://nattapat2871.me)

const LABELED_PLAYER_NAME_PATTERN = /((?:login successful for user|offline login request for user|offline profile|player name|profile name|account name|username)\s*[:=]\s*)([^\s,;]+)/gi

export const redactLabeledPlayerNames = (value: unknown) => (
  String(value ?? '').replace(LABELED_PLAYER_NAME_PATTERN, '$1[redacted-player]')
)
