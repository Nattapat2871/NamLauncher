import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import electron from 'vite-plugin-electron'
import { notBundle } from 'vite-plugin-electron/plugin'

const PUBLIC_ERROR_REPORT_TOKEN = 'namlauncher-error-report-public-v1-nattapat2871'

export default defineConfig(({ mode }) => {
  const buildEnv = loadEnv(mode, process.cwd(), '')
  const errorReportToken = String(
    process.env.NAMLAUNCHER_ERROR_REPORT_TOKEN
    || buildEnv.NAMLAUNCHER_ERROR_REPORT_TOKEN
    || PUBLIC_ERROR_REPORT_TOKEN
  ).trim()

  return {
  plugins: [
    react(),
    electron([
      {
        // Main process entry
        entry: 'electron/main.ts',
        onstart(options) {
          const electronEnv = { ...process.env }
          delete electronEnv.ELECTRON_RUN_AS_NODE
          options.startup(undefined, { env: electronEnv })
        },
        vite: {
          plugins: [notBundle()],
          define: {
            __NAMLAUNCHER_ERROR_REPORT_TOKEN__: JSON.stringify(errorReportToken),
          },
          build: {
            outDir: 'dist-electron',
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // The 3D skin engine is intentionally deferred behind a dynamic import.
    chunkSizeWarningLimit: 560,
  },
  server: {
    // Let Vite pick an available port
    watch: {
      ignored: [
        '**/.git/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/dist-electron/**',
        '**/release/**',
        '**/*.log',
        '**/*.exe',
        '**/*.dll',
        '**/*.zip',
        '**/*.tar.gz'
      ]
    }
  }
  }
})
