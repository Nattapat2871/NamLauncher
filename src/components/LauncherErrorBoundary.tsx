import React from 'react'
import { ClipboardCopy, FolderOpen, RefreshCw, ShieldAlert } from 'lucide-react'

// Author/creator: nattapat2871 (https://nattapat2871.me)

type LauncherErrorBoundaryProps = {
  children: React.ReactNode
}

type LauncherErrorBoundaryState = {
  error: Error | null
  errorInfo: React.ErrorInfo | null
  copied: boolean
}

const getDiagnosticReport = (error: Error, errorInfo: React.ErrorInfo | null) => [
  'NamLauncher renderer crash report',
  `Time: ${new Date().toISOString()}`,
  `Message: ${error.message || 'Unknown renderer error'}`,
  '',
  'Stack:',
  error.stack || '(no stack)',
  '',
  'Component stack:',
  errorInfo?.componentStack || '(no component stack)'
].join('\n')

class LauncherErrorBoundary extends React.Component<LauncherErrorBoundaryProps, LauncherErrorBoundaryState> {
  state: LauncherErrorBoundaryState = {
    error: null,
    errorInfo: null,
    copied: false
  }

  static getDerivedStateFromError(error: Error) {
    return { error, copied: false }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ error, errorInfo, copied: false })
  }

  copyReport = async () => {
    const { error, errorInfo } = this.state
    if (!error || !(window as any).electron?.copyErrorReport) return

    await (window as any).electron.copyErrorReport(getDiagnosticReport(error, errorInfo))
    this.setState({ copied: true })
  }

  render() {
    const { error, copied } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#08111f] p-6 text-slate-100">
        <section className="w-full max-w-2xl rounded-lg border border-red-400/30 bg-[#0d1729] p-6 shadow-2xl shadow-red-950/20">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-red-300/25 bg-red-500/12 text-red-200">
              <ShieldAlert size={22} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-red-300">Renderer recovered</p>
              <h1 className="mt-2 text-2xl font-black text-white">NamLauncher UI stopped unexpectedly</h1>
              <p className="mt-3 text-sm font-semibold leading-7 text-slate-300">
                The launcher protected the app from a blank screen. Copy the diagnostic report or reopen the UI.
              </p>
            </div>
          </div>

          <pre className="nam-selectable mt-5 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/45 p-4 font-mono text-[11px] leading-5 text-slate-300">
            {error.stack || error.message || 'Unknown renderer error'}
          </pre>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex h-11 items-center gap-2 rounded-lg bg-blue-500 px-4 text-sm font-black text-white hover:bg-blue-400"
            >
              <RefreshCw size={16} />
              Reopen UI
            </button>
            {(window as any).electron?.copyErrorReport && (
              <button
                type="button"
                onClick={this.copyReport}
                className="flex h-11 items-center gap-2 rounded-lg border border-slate-700 px-4 text-sm font-black text-slate-200 hover:bg-slate-800"
              >
                <ClipboardCopy size={16} />
                {copied ? 'Copied' : 'Copy report'}
              </button>
            )}
            {(window as any).electron?.openLogs && (
              <button
                type="button"
                onClick={() => (window as any).electron.openLogs()}
                className="flex h-11 items-center gap-2 rounded-lg border border-slate-700 px-4 text-sm font-black text-slate-200 hover:bg-slate-800"
              >
                <FolderOpen size={16} />
                Open logs
              </button>
            )}
          </div>
        </section>
      </div>
    )
  }
}

export default LauncherErrorBoundary
