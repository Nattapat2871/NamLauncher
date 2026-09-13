import { type PropsWithChildren, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type ActiveTooltip = {
  target: HTMLElement
  content: string
}

type TooltipPosition = {
  left: number
  top: number
  arrowLeft: number
  placement: 'top' | 'bottom'
  ready: boolean
}

const TOOLTIP_ID = 'namlauncher-custom-tooltip'
const VIEWPORT_GAP = 12
const TRIGGER_GAP = 10

const findTooltipTarget = (target: EventTarget | null) => (
  target instanceof Element
    ? target.closest<HTMLElement>('[data-tooltip]')
    : null
)

export default function TooltipProvider({ children }: PropsWithChildren) {
  const [active, setActive] = useState<ActiveTooltip | null>(null)
  const [position, setPosition] = useState<TooltipPosition>({
    left: 0,
    top: 0,
    arrowLeft: 0,
    placement: 'top',
    ready: false
  })
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const activeTargetRef = useRef<HTMLElement | null>(null)
  const showTimerRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const convertNativeTitle = (element: Element) => {
      if (!(element instanceof HTMLElement)) return
      const nativeTitle = element.getAttribute('title')?.trim()
      if (!nativeTitle) return
      if (!element.dataset.tooltip) element.dataset.tooltip = nativeTitle
      element.removeAttribute('title')
    }

    document.querySelectorAll('[title]').forEach(convertNativeTitle)
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        if (record.type === 'attributes') convertNativeTitle(record.target as Element)
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return
          convertNativeTitle(node)
          node.querySelectorAll('[title]').forEach(convertNativeTitle)
        })
      })
    })

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title']
    })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const cancelShow = () => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current)
        showTimerRef.current = null
      }
    }

    const hide = () => {
      cancelShow()
      activeTargetRef.current = null
      setActive(null)
    }

    const show = (target: HTMLElement, immediate = false) => {
      const content = target.dataset.tooltip?.trim()
      if (!content) return
      cancelShow()
      activeTargetRef.current = target
      const activate = () => {
        if (activeTargetRef.current !== target || !target.isConnected) return
        setPosition((current) => ({ ...current, ready: false }))
        setActive({ target, content })
      }
      if (immediate) activate()
      else showTimerRef.current = window.setTimeout(activate, 260)
    }

    const onPointerOver = (event: PointerEvent) => {
      const target = findTooltipTarget(event.target)
      if (!target || target === findTooltipTarget(event.relatedTarget)) return
      show(target)
    }
    const onPointerOut = (event: PointerEvent) => {
      const target = findTooltipTarget(event.target)
      if (!target || target !== activeTargetRef.current) return
      if (target === findTooltipTarget(event.relatedTarget)) return
      hide()
    }
    const onFocusIn = (event: FocusEvent) => {
      const target = findTooltipTarget(event.target)
      if (target) show(target, true)
    }
    const onFocusOut = (event: FocusEvent) => {
      const target = findTooltipTarget(event.target)
      if (target && target === activeTargetRef.current) hide()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }

    document.addEventListener('pointerover', onPointerOver)
    document.addEventListener('pointerout', onPointerOut)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelShow()
      document.removeEventListener('pointerover', onPointerOver)
      document.removeEventListener('pointerout', onPointerOut)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useLayoutEffect(() => {
    if (!active || !tooltipRef.current) return
    const trigger = active.target.getBoundingClientRect()
    const tooltip = tooltipRef.current.getBoundingClientRect()
    const placement = trigger.top >= tooltip.height + TRIGGER_GAP + VIEWPORT_GAP ? 'top' : 'bottom'
    const idealLeft = trigger.left + trigger.width / 2 - tooltip.width / 2
    const left = Math.min(
      Math.max(VIEWPORT_GAP, idealLeft),
      Math.max(VIEWPORT_GAP, window.innerWidth - tooltip.width - VIEWPORT_GAP)
    )
    const top = placement === 'top'
      ? trigger.top - tooltip.height - TRIGGER_GAP
      : trigger.bottom + TRIGGER_GAP
    const arrowLeft = Math.min(
      Math.max(14, trigger.left + trigger.width / 2 - left - 4),
      Math.max(14, tooltip.width - 22)
    )

    setPosition({ left, top, arrowLeft, placement, ready: true })
    const describedBy = active.target.getAttribute('aria-describedby')
    const nextDescribedBy = [describedBy, TOOLTIP_ID].filter(Boolean).join(' ')
    active.target.setAttribute('aria-describedby', nextDescribedBy)

    const hideOnViewportChange = () => setActive(null)
    window.addEventListener('resize', hideOnViewportChange)
    window.addEventListener('scroll', hideOnViewportChange, true)
    return () => {
      if (describedBy) active.target.setAttribute('aria-describedby', describedBy)
      else active.target.removeAttribute('aria-describedby')
      window.removeEventListener('resize', hideOnViewportChange)
      window.removeEventListener('scroll', hideOnViewportChange, true)
    }
  }, [active])

  return (
    <>
      {children}
      {active && createPortal(
        <div
          ref={tooltipRef}
          id={TOOLTIP_ID}
          role="tooltip"
          className="nam-custom-tooltip pointer-events-none fixed z-[10000] max-w-[320px] rounded-lg border border-blue-300/20 bg-[#101b30]/[0.98] px-3 py-2 text-center text-[11px] font-bold leading-4 text-slate-100 shadow-[0_14px_40px_rgba(0,0,0,0.48),0_0_0_1px_rgba(59,130,246,0.06)] backdrop-blur-xl"
          style={{
            left: position.left,
            top: position.top,
            opacity: position.ready ? 1 : 0
          }}
        >
          {active.content}
          <span
            aria-hidden="true"
            className="absolute h-2 w-2 rotate-45 border-blue-300/20 bg-[#101b30]"
            style={{
              left: position.arrowLeft,
              ...(position.placement === 'top'
                ? { bottom: -5, borderBottomWidth: 1, borderRightWidth: 1 }
                : { top: -5, borderLeftWidth: 1, borderTopWidth: 1 })
            }}
          />
        </div>,
        document.body
      )}
    </>
  )
}
