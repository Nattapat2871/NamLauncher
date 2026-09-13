// Author/creator: nattapat2871 (https://nattapat2871.me)
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export type InstanceSelectOption = {
  value: string
  label: string
  detail?: string
}

type InstanceSelectProps = {
  label: string
  value: string
  options: readonly InstanceSelectOption[]
  onChange: (value: string) => void
  onOpen?: () => void
  renderIcon?: (value: string) => ReactNode
  disabled?: boolean
  testId?: string
}

type MenuPosition = {
  top: number
  left: number
  width: number
  maxHeight: number
}

const MENU_GAP = 6
const MENU_MARGIN = 8
const MENU_MAX_HEIGHT = 320
const MENU_MIN_HEIGHT = 132

export function InstanceSelect({
  label,
  value,
  options,
  onChange,
  onOpen,
  renderIcon,
  disabled = false,
  testId
}: InstanceSelectProps) {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typeaheadRef = useRef({ value: '', at: 0 })
  const [open, setOpen] = useState(false)
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selectedOption = options[selectedIndex]
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)

  const positionMenu = () => {
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const desiredHeight = Math.min(MENU_MAX_HEIGHT, Math.max(MENU_MIN_HEIGHT, options.length * 46 + 8))
    const below = Math.max(0, window.innerHeight - rect.bottom - MENU_MARGIN - MENU_GAP)
    const above = Math.max(0, rect.top - MENU_MARGIN - MENU_GAP)
    const openAbove = below < Math.min(desiredHeight, 200) && above > below
    const availableHeight = openAbove ? above : below
    const maxHeight = Math.max(MENU_MIN_HEIGHT, Math.min(desiredHeight, availableHeight))
    const top = openAbove
      ? Math.max(MENU_MARGIN, rect.top - maxHeight - MENU_GAP)
      : Math.min(window.innerHeight - MENU_MARGIN - maxHeight, rect.bottom + MENU_GAP)
    setMenuPosition({
      top: Math.max(MENU_MARGIN, top),
      left: Math.max(MENU_MARGIN, Math.min(rect.left, window.innerWidth - rect.width - MENU_MARGIN)),
      width: Math.min(rect.width, window.innerWidth - MENU_MARGIN * 2),
      maxHeight
    })
  }

  useEffect(() => {
    if (!open) return
    positionMenu()
    const reposition = () => positionMenu()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (!buttonRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  useEffect(() => {
    if (!open) return
    const option = listRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
    option?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open, menuPosition])

  useEffect(() => {
    if (!open) setActiveIndex(selectedIndex)
  }, [open, selectedIndex])

  const showMenu = () => {
    if (disabled || options.length === 0) return
    onOpen?.()
    setActiveIndex(selectedIndex)
    setOpen(true)
  }

  const choose = (index: number) => {
    const option = options[index]
    if (!option) return
    setOpen(false)
    if (option.value !== value) onChange(option.value)
    window.requestAnimationFrame(() => buttonRef.current?.focus())
  }

  const moveActive = (index: number) => {
    if (options.length === 0) return
    setActiveIndex(Math.max(0, Math.min(options.length - 1, index)))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      }
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(activeIndex)
      else showMenu()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        showMenu()
        moveActive(selectedIndex + (event.key === 'ArrowDown' ? 1 : -1))
      } else {
        moveActive(activeIndex + (event.key === 'ArrowDown' ? 1 : -1))
      }
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      if (!open) showMenu()
      moveActive(event.key === 'Home' ? 0 : options.length - 1)
      return
    }
    if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault()
      if (!open) showMenu()
      moveActive(activeIndex + (event.key === 'PageDown' ? 8 : -8))
      return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now()
      const prefix = now - typeaheadRef.current.at < 650
        ? `${typeaheadRef.current.value}${event.key}`
        : event.key
      typeaheadRef.current = { value: prefix.toLocaleLowerCase(), at: now }
      const match = options.findIndex((option) => option.label.toLocaleLowerCase().startsWith(typeaheadRef.current.value))
      if (match >= 0) {
        event.preventDefault()
        if (!open) showMenu()
        moveActive(match)
      }
    }
  }

  const menu = open && menuPosition && createPortal(
    <div
      ref={listRef}
      id={`${id}-list`}
      role="listbox"
      aria-labelledby={`${id}-label`}
      data-testid={testId ? `${testId}-listbox` : undefined}
      className="fixed z-[90] overflow-y-auto rounded-xl border border-slate-600/80 bg-[#101a2c] p-1.5 shadow-2xl shadow-black/60 outline-none"
      style={menuPosition}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          id={`${id}-option-${index}`}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={selectedIndex === index}
          data-option-index={index}
          onPointerDown={(event) => event.preventDefault()}
          onPointerMove={() => setActiveIndex(index)}
          onClick={() => choose(index)}
          className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors ${
            activeIndex === index ? 'bg-blue-500/20 text-white' : 'text-slate-300 hover:bg-slate-800/80'
          }`}
        >
          {renderIcon && (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">
              {renderIcon(option.value)}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-black">{option.label}</span>
            {option.detail && <span className="mt-0.5 block truncate text-[10px] font-semibold text-slate-500">{option.detail}</span>}
          </span>
          {selectedIndex === index && <Check size={16} aria-hidden="true" className="shrink-0 text-blue-300" />}
        </button>
      ))}
    </div>,
    document.body
  )

  return (
    <div className="min-w-0 space-y-2">
      <span id={`${id}-label`} className="block text-xs font-black uppercase tracking-[0.16em] text-slate-500">
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        disabled={disabled || options.length === 0}
        data-testid={testId}
        onClick={() => open ? setOpen(false) : showMenu()}
        onKeyDown={onKeyDown}
        className="flex h-11 w-full items-center gap-3 rounded-lg border border-slate-700 bg-slate-950/55 px-3 text-left text-sm font-black text-slate-100 outline-none transition-colors hover:border-slate-500 hover:bg-slate-950/75 focus-visible:border-blue-400/70 focus-visible:ring-2 focus-visible:ring-blue-400/40 disabled:cursor-not-allowed disabled:opacity-55"
      >
        {renderIcon && selectedOption && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">
            {renderIcon(selectedOption.value)}
          </span>
        )}
        <span id={`${id}-value`} className="min-w-0 flex-1 truncate">{selectedOption?.label || value || '—'}</span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-slate-400 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {menu}
    </div>
  )
}
