import { useEffect, useState } from 'react'

type StaticSkinPreviewProps = {
  skin: string
  model: 'classic' | 'slim'
  alt: string
  className?: string
}

const previewCache = new Map<string, string>()
const pendingPreviews = new Map<string, Promise<string>>()
let renderQueue = Promise.resolve()

const renderSkinPreview = async (skin: string, model: StaticSkinPreviewProps['model']) => {
  const { SkinViewer: SkinView3D } = await import('skinview3d')
  const canvas = document.createElement('canvas')
  const viewer = new SkinView3D({
    canvas,
    width: 256,
    height: 220,
    pixelRatio: 1,
    enableControls: false,
    renderPaused: true,
    background: 0x000000,
    fov: 36,
    zoom: 1.25
  })

  try {
    viewer.background = null
    viewer.globalLight.intensity = 2.2
    viewer.cameraLight.intensity = 1
    await Promise.resolve(viewer.loadSkin(skin, { model: model === 'slim' ? 'slim' : 'default' }))

    // A fixed three-quarter bust angle, rendered once and then displayed as a normal PNG.
    viewer.playerWrapper.rotation.y = -0.3
    viewer.playerWrapper.position.y = -7
    viewer.camera.position.set(0, 0, 1)
    viewer.zoom = 1.25
    viewer.render()
    return canvas.toDataURL('image/png')
  } finally {
    viewer.dispose()
  }
}

const getSkinPreview = (skin: string, model: StaticSkinPreviewProps['model']) => {
  const key = `${model}:${skin}`
  const cached = previewCache.get(key)
  if (cached) return Promise.resolve(cached)

  const pending = pendingPreviews.get(key)
  if (pending) return pending

  const task = renderQueue
    .catch(() => undefined)
    .then(() => renderSkinPreview(skin, model))
    .then((preview) => {
      previewCache.set(key, preview)
      pendingPreviews.delete(key)
      return preview
    })
    .catch((error) => {
      pendingPreviews.delete(key)
      throw error
    })

  renderQueue = task.then(() => undefined, () => undefined)
  pendingPreviews.set(key, task)
  return task
}

const StaticSkinPreview = ({ skin, model, alt, className = '' }: StaticSkinPreviewProps) => {
  const cacheKey = `${model}:${skin}`
  const [preview, setPreview] = useState(() => previewCache.get(cacheKey) || '')

  useEffect(() => {
    let active = true
    setPreview(previewCache.get(cacheKey) || '')
    void getSkinPreview(skin, model)
      .then((nextPreview) => {
        if (active) setPreview(nextPreview)
      })
      .catch(() => {
        if (active) setPreview('')
      })
    return () => {
      active = false
    }
  }, [cacheKey, skin, model])

  if (!preview) {
    return <div className={`animate-pulse bg-slate-800/20 ${className}`} aria-label={alt} />
  }

  return <img src={preview} alt={alt} draggable={false} className={`object-contain [image-rendering:pixelated] ${className}`} />
}

export default StaticSkinPreview
