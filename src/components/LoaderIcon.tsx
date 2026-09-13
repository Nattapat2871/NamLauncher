// Author/creator: nattapat2871 (https://nattapat2871.me)
// Official loader artwork is bundled locally; see ../assets/loader-icons/NOTICE.md.
import type { HTMLAttributes } from 'react'
import fabricIcon from '../assets/loader-icons/fabric.png'
import forgeIcon from '../assets/loader-icons/forge.ico'
import neoforgeIcon from '../assets/loader-icons/neoforge.png'
import quiltIcon from '../assets/loader-icons/quilt.svg'
import vanillaIcon from '../assets/loader-icons/vanilla.svg'

type LoaderName = 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt'

const LOADER_ARTWORK: Record<LoaderName, { label: string; source: string; pixelated?: boolean }> = {
  vanilla: { label: 'Minecraft Vanilla', source: vanillaIcon },
  fabric: { label: 'Fabric', source: fabricIcon, pixelated: true },
  forge: { label: 'Minecraft Forge', source: forgeIcon },
  neoforge: { label: 'NeoForge', source: neoforgeIcon, pixelated: true },
  quilt: { label: 'Quilt', source: quiltIcon }
}

type LoaderIconProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  loader: string
}

const normalizeLoader = (loader: string): LoaderName => {
  const value = String(loader || '').trim().toLowerCase()
  return value in LOADER_ARTWORK ? value as LoaderName : 'vanilla'
}

export default function LoaderIcon({ loader, className = '', ...props }: LoaderIconProps) {
  const artwork = LOADER_ARTWORK[normalizeLoader(loader)]

  return (
    <span
      role="img"
      aria-label={`${artwork.label} loader`}
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      {...props}
    >
      <img
        src={artwork.source}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`h-full w-full object-contain ${artwork.pixelated ? '[image-rendering:pixelated]' : ''}`}
      />
    </span>
  )
}
