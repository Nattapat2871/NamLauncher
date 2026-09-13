// Author/creator: nattapat2871 (https://nattapat2871.me)
import fs from 'node:fs'
import path from 'node:path'

export const PUBLIC_ERROR_REPORT_TOKEN = 'namlauncher-error-report-public-v1-nattapat2871'

const parseEnvValue = (value) => {
  const trimmed = String(value || '').trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"')
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const readEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return {}

  const values = {}
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    values[match[1]] = parseEnvValue(match[2])
  }
  return values
}

export const loadBuildEnvValue = (name, mode = 'production') => {
  const envFiles = [
    '.env',
    '.env.local',
    `.env.${mode}`,
    `.env.${mode}.local`
  ]
  const values = {}

  for (const fileName of envFiles) {
    Object.assign(values, readEnvFile(path.resolve(fileName)))
  }

  const fallback = name === 'NAMLAUNCHER_ERROR_REPORT_TOKEN' ? PUBLIC_ERROR_REPORT_TOKEN : ''
  return String(process.env[name] || values[name] || fallback).trim()
}
