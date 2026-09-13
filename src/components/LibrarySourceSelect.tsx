// Author/creator: nattapat2871 (https://nattapat2871.me)
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { ProviderIcon, type LibraryProvider } from './ProviderIcon'

const providers: ReadonlyArray<{ id: LibraryProvider; name: string }> = [
  { id: 'modrinth', name: 'Modrinth' }, { id: 'curseforge', name: 'CurseForge' }
]

export function LibrarySourceSelect({ value, label, onChange }: {
  value: LibraryProvider; label: string; onChange: (value: LibraryProvider) => void
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const selected = Math.max(0, providers.findIndex(provider => provider.id === value))
  const [active, setActive] = useState(selected)
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  const choose = (index: number) => {
    setOpen(false)
    if (providers[index].id !== value) onChange(providers[index].id)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Tab') { setOpen(false); return }
    if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
      return
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      setActive(event.key === 'Home' ? 0 : event.key === 'End' ? providers.length - 1
        : !open ? selected : (active + (event.key === 'ArrowDown' ? 1 : -1) + providers.length) % providers.length)
      setOpen(true)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(active)
      else { setActive(selected); setOpen(true) }
    } else {
      const index = providers.findIndex(provider => provider.name[0].toLowerCase() === event.key.toLowerCase())
      if (index >= 0 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); setActive(index); setOpen(true)
      }
    }
  }

  return <div ref={root} className="no-drag relative min-w-[180px]" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }}>
    <span id={`${id}-label`} className="mb-1.5 block text-right text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</span>
    <button type="button" role="combobox" aria-labelledby={`${id}-label ${id}-value`}
      aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? `${id}-list` : undefined}
      aria-activedescendant={open ? `${id}-option-${active}` : undefined}
      onKeyDown={onKeyDown} onClick={() => { setActive(selected); setOpen(!open) }}
      className="flex h-11 w-full items-center gap-2.5 rounded-lg border border-slate-700 bg-slate-950/60 px-3 text-xs font-black text-slate-100 outline-none transition-colors hover:border-slate-500 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1526]">
      <ProviderIcon provider={value} /><span id={`${id}-value`}>{providers[selected].name}</span>
      <ChevronDown size={15} aria-hidden="true" className={`ml-auto text-slate-400 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`}
      className="absolute right-0 top-full z-50 mt-1.5 w-full rounded-xl border border-slate-600/70 bg-[#101a2c] p-1 shadow-xl shadow-black/40">
      {providers.map((provider, index) => <button key={provider.id} id={`${id}-option-${index}`}
        type="button" role="option" tabIndex={-1} aria-selected={selected === index}
        onPointerDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(index)}
        className={`flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left text-xs font-bold outline-none ${active === index ? 'bg-blue-500/20 text-white' : 'text-slate-300'}`}>
        <ProviderIcon provider={provider.id} /><span>{provider.name}</span>
        {selected === index && <Check size={15} aria-hidden="true" className="ml-auto text-blue-300" />}
      </button>)}
    </div>}
  </div>
}
