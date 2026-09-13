// Author/creator: nattapat2871 (https://nattapat2871.me)
import { AlertTriangle, CheckCircle2, Expand, Loader2, Package, X } from 'lucide-react'
import { m as motion } from 'framer-motion'
import type { ReactNode } from 'react'

export type ModpackInstallActivityPhase = 'installing' | 'success' | 'error'

export type ModpackInstallActivity = {
  taskId: string
  projectId: string
  title: string
  iconUrl?: string
  phase: ModpackInstallActivityPhase
  progress: number
  detail: string
  minimized: boolean
}

type ModpackInstallActivityCardProps = {
  activity: ModpackInstallActivity
  icon?: ReactNode
  reduceMotion: boolean
  labels: {
    installing: string
    completed: string
    failed: string
    restore: string
    dismiss: string
  }
  onRestore: () => void
  onDismiss: () => void
}

const clampProgress = (value: number) => Math.min(Math.max(Math.round(value), 0), 100)

const ModpackInstallActivityCard = ({
  activity,
  icon,
  reduceMotion,
  labels,
  onRestore,
  onDismiss
}: ModpackInstallActivityCardProps) => {
  const progress = clampProgress(activity.progress)
  const isInstalling = activity.phase === 'installing'
  const isSuccess = activity.phase === 'success'
  const phaseLabel = isInstalling ? labels.installing : isSuccess ? labels.completed : labels.failed

  return (
    <motion.aside
      layout
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 44, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 72, scale: 0.98 }}
      transition={{ duration: reduceMotion ? 0.1 : 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-auto w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-xl border border-slate-700/90 bg-[#0d1526]/98 shadow-2xl shadow-black/45 backdrop-blur-xl"
      aria-label={`${phaseLabel}: ${activity.title}`}
    >
      <div className="flex items-start gap-3 p-3.5">
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-slate-500">
          {icon || <Package size={18} aria-hidden="true" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {isInstalling ? (
              <Loader2 size={14} className="shrink-0 animate-spin text-blue-300" aria-hidden="true" />
            ) : isSuccess ? (
              <CheckCircle2 size={14} className="shrink-0 text-emerald-300" aria-hidden="true" />
            ) : (
              <AlertTriangle size={14} className="shrink-0 text-rose-300" aria-hidden="true" />
            )}
            <p
              className={isSuccess
                ? 'truncate text-[11px] font-black uppercase tracking-[0.14em] text-emerald-300'
                : activity.phase === 'error'
                  ? 'truncate text-[11px] font-black uppercase tracking-[0.14em] text-rose-300'
                  : 'truncate text-[11px] font-black uppercase tracking-[0.14em] text-blue-300'}
              aria-live="polite"
            >
              {phaseLabel}
            </p>
          </div>
          <h2 className="mt-1 truncate text-sm font-black text-white" title={activity.title}>{activity.title}</h2>
          <p className="mt-1 truncate text-xs font-semibold text-slate-400" title={activity.detail}>{activity.detail}</p>
        </div>

        {isSuccess ? null : (
          <button
            type="button"
            onClick={onRestore}
            aria-label={labels.restore}
            data-tooltip={labels.restore}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-blue-500/12 hover:text-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70"
          >
            <Expand size={16} aria-hidden="true" />
          </button>
        )}

        {activity.phase === 'error' && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={labels.dismiss}
            data-tooltip={labels.dismiss}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-rose-500/12 hover:text-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/70"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      <div
        role="progressbar"
        aria-label={phaseLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        className="h-1.5 bg-slate-900"
      >
        <motion.div
          initial={false}
          animate={{ width: `${isSuccess ? 100 : progress}%` }}
          transition={{ duration: reduceMotion ? 0.1 : 0.2, ease: 'easeOut' }}
          className={isSuccess ? 'h-full bg-emerald-400' : activity.phase === 'error' ? 'h-full bg-rose-400' : 'h-full bg-blue-400'}
        />
      </div>
    </motion.aside>
  )
}

export default ModpackInstallActivityCard
