import { loadBuildEnvValue } from './env-utils.mjs'

const token = loadBuildEnvValue('NAMLAUNCHER_ERROR_REPORT_TOKEN')

if (!token) {
  console.error('NAMLAUNCHER_ERROR_REPORT_TOKEN is required before packaging NamLauncher.')
  console.error('Set it in the shell, .env.local, or .env.production.local, or keep the built-in public report-only token.')
  process.exit(1)
}

if (token.length < 16) {
  console.error('NAMLAUNCHER_ERROR_REPORT_TOKEN is too short to be a valid report token.')
  process.exit(1)
}

process.stdout.write('Error report token is present for packaging.\n')
