// Author/creator: nattapat2871 (https://nattapat2871.me)
import React from 'react'
import ReactDOM from 'react-dom/client'
import { LazyMotion } from 'framer-motion'
import App from './App'
import LauncherErrorBoundary from './components/LauncherErrorBoundary'
import TooltipProvider from './components/TooltipProvider'
import './index.css'

const loadMotionFeatures = () => import('./motionFeatures').then((module) => module.default)

const BrowserFallback = () => (
  <div className="flex min-h-screen items-center justify-center bg-[#08111f] p-6 text-slate-100">
    <div className="w-full max-w-lg rounded-lg border border-blue-400/20 bg-[#0d1729] p-6 shadow-2xl shadow-black/40">
      <div className="flex items-center gap-3">
        <img src="./namlauncher-icon.png" alt="" className="h-12 w-12 rounded-lg object-contain outline-0" />
        <div>
          <h1 className="text-xl font-black">NamLauncher</h1>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-300">Electron required</p>
        </div>
      </div>
      <p className="mt-5 text-sm font-semibold leading-7 text-slate-300">
        This launcher UI needs the Electron bridge to open files, install packs, launch Minecraft, and manage accounts.
        Start it with <code className="rounded bg-slate-950/70 px-1.5 py-0.5 text-blue-200">npm run dev</code> or install the Windows build.
      </p>
    </div>
  </div>
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LazyMotion features={loadMotionFeatures} strict>
      <TooltipProvider>
        <LauncherErrorBoundary>
          {(window as any).electron ? <App /> : <BrowserFallback />}
        </LauncherErrorBoundary>
      </TooltipProvider>
    </LazyMotion>
  </React.StrictMode>,
)
