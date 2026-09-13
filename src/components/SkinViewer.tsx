import { useEffect, useRef } from 'react'

type SkinView3DInstance = import('skinview3d').SkinViewer

type SkinViewerProps = {
  skin?: string | null
  cape?: string | null
  model?: 'classic' | 'slim'
  autoRotate?: boolean
  controls?: boolean
  zoom?: number
  className?: string
  canvasClassName?: string
}

const SkinViewer = ({
  skin,
  cape,
  model = 'classic',
  autoRotate = false,
  controls = true,
  zoom = 0.78,
  className = '',
  canvasClassName = ''
}: SkinViewerProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const viewerRef = useRef<SkinView3DInstance | null>(null)
  const latestPropsRef = useRef({ skin, cape, model, autoRotate, controls, zoom })

  useEffect(() => {
    latestPropsRef.current = { skin, cape, model, autoRotate, controls, zoom }
  }, [skin, cape, model, autoRotate, controls, zoom])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    let disposed = false
    let observer: ResizeObserver | null = null
    let viewer: SkinView3DInstance | null = null

    void import('skinview3d').then(({ IdleAnimation, SkinViewer: SkinView3D }) => {
      if (disposed) return
      const initialProps = latestPropsRef.current
      viewer = new SkinView3D({
        canvas,
        width: Math.max(1, container.clientWidth),
        height: Math.max(1, container.clientHeight),
        pixelRatio: 'match-device',
        enableControls: initialProps.controls,
        background: 0x000000,
        zoom: initialProps.zoom,
        fov: 48,
        animation: new IdleAnimation()
      })

      viewer.background = null
      if (viewer.controls) {
        viewer.controls.enablePan = false
        viewer.controls.enableZoom = false
        viewer.controls.minPolarAngle = Math.PI / 3.2
        viewer.controls.maxPolarAngle = Math.PI / 1.7
      }
      viewer.autoRotateSpeed = 0.7
      viewer.autoRotate = initialProps.autoRotate
      viewer.cameraLight.intensity = 0.9
      viewer.globalLight.intensity = 2.1
      viewer.nameTag = null
      viewerRef.current = viewer

      if (initialProps.skin) {
        void Promise.resolve(viewer.loadSkin(initialProps.skin, { model: initialProps.model === 'slim' ? 'slim' : 'default' }))
          .catch(() => viewer?.loadSkin(null))
      }
      if (initialProps.cape) {
        void Promise.resolve(viewer.loadCape(initialProps.cape)).catch(() => viewer?.loadCape(null))
      }

      observer = new ResizeObserver(([entry]) => {
        if (!viewer) return
        const width = Math.max(1, Math.floor(entry.contentRect.width))
        const height = Math.max(1, Math.floor(entry.contentRect.height))
        viewer.setSize(width, height)
      })
      observer.observe(container)
    })

    return () => {
      disposed = true
      observer?.disconnect()
      viewer?.dispose()
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    if (!skin) {
      viewer.loadSkin(null)
      return
    }
    void Promise.resolve(viewer.loadSkin(skin, { model: model === 'slim' ? 'slim' : 'default' }))
      .catch(() => viewer.loadSkin(null))
  }, [skin, model])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    if (!cape) {
      viewer.loadCape(null)
      return
    }
    void Promise.resolve(viewer.loadCape(cape)).catch(() => viewer.loadCape(null))
  }, [cape])

  useEffect(() => {
    if (viewerRef.current) viewerRef.current.autoRotate = autoRotate
  }, [autoRotate])

  useEffect(() => {
    if (viewerRef.current) viewerRef.current.zoom = zoom
  }, [zoom])

  return (
    <div ref={containerRef} className={className}>
      <canvas
        ref={canvasRef}
        className={[
          'h-full w-full outline-0',
          controls ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none',
          canvasClassName
        ].filter(Boolean).join(' ')}
      />
    </div>
  )
}

export default SkinViewer
