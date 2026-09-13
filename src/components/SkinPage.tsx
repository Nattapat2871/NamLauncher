import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Cloud,
  Download,
  Edit3,
  ImagePlus,
  Loader2,
  Rotate3D,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  User,
  X
} from 'lucide-react'
import { AnimatePresence, m as motion } from 'framer-motion'
import SkinViewer from './SkinViewer'
import StaticSkinPreview from './StaticSkinPreview'

type SkinAccount = {
  id: string
  uuid: string
  name: string
  type: 'msa' | 'offline'
}

export type SkinPreset = {
  id: string
  name: string
  model: 'classic' | 'slim'
  capeId?: string | null
  capeTextureDataUrl?: string | null
  sourceProfileUuid?: string | null
  sourceProfileName?: string | null
  textureDataUrl: string
  createdAt?: string
  updatedAt?: string
  source?: 'minecraft' | 'default'
}

export type SkinCape = {
  id: string
  name: string
  textureDataUrl: string
  active: boolean
}

export type SkinLibraryData = {
  accountId: string
  accountUuid: string
  accountName: string
  accountType: 'msa' | 'offline'
  selectedSkinId: string | null
  activeDefaultSkinId?: string | null
  currentSkin: SkinPreset | null
  effectiveSkin?: SkinPreset | null
  savedSkins: SkinPreset[]
  capes: SkinCape[]
  activeCapeId: string | null
  warning?: string | null
  offlineOnly: boolean
}

type SkinDraft = {
  skinId?: string
  name: string
  model: 'classic' | 'slim'
  textureDataUrl: string
  capeId: string | null
  capeTextureDataUrl?: string | null
  sourceProfileName?: string | null
}

type SkinPageProps = {
  accounts: SkinAccount[]
  activeAccountId: string | null
  language: 'en' | 'th'
  onRequestLogin: () => void
  onStatus: (message: string) => void
  onLibraryChange?: (library: SkinLibraryData) => void
}

const copy = {
  en: {
    title: 'Skin selector',
    subtitle: 'Import, preview, save, and equip skins for the player selected in the sidebar.',
    preview: 'Current preview',
    rotate: 'Drag to rotate',
    edit: 'Edit skin',
    reset: 'Reset default',
    saved: 'Saved skins',
    defaults: 'Default skins',
    add: 'Add skin',
    drop: 'Drop a PNG here',
    useSkin: 'Use skin',
    applyingDefault: 'Applying default skin',
    minecraft: 'Minecraft profile',
    noSkins: 'No saved skins yet',
    offlineTitle: 'Offline skin',
    offlineBody: 'This skin is injected locally for single-player. Online servers normally will not show it to other players.',
    restoreTitle: 'Import from a Minecraft player',
    restoreBody: 'Paste a Minecraft player name or NameMC profile link. Microsoft accounts equip the imported skin immediately; Offline accounts keep it for local preview.',
    localBadge: 'Offline',
    syncedBadge: 'Synced',
    restorePlaceholder: 'Player name or NameMC profile link',
    restore: 'Import skin',
    restoring: 'Looking up player',
    restoredOk: 'Player skin imported and equipped',
    source: 'Source',
    onlineBody: 'Saving equips this skin on your real Minecraft profile. Rejoin a server to refresh it.',
    signIn: 'Add a player profile',
    editing: 'Editing skin',
    texture: 'Texture',
    replace: 'Replace texture',
    name: 'Preset name',
    arms: 'Arm style',
    wide: 'Wide',
    slim: 'Slim',
    cape: 'Cape',
    none: 'None',
    cancel: 'Cancel',
    save: 'Save skin',
    saving: 'Saving',
    applying: 'Applying skin',
    delete: 'Delete preset',
    confirmDelete: 'Delete this saved skin preset?',
    invalid: 'Choose a 64x64 or legacy 64x32 PNG skin under 2 MB.',
    loaded: 'Skin library loaded',
    savedOk: 'Skin saved and equipped',
    appliedOk: 'Skin equipped',
    resetOk: 'Default skin restored'
  },
  th: {
    title: 'ตัวเลือกสกิน',
    subtitle: 'นำเข้า ดูตัวอย่าง บันทึก และใช้สกินกับผู้เล่นที่เลือกจากแถบด้านซ้าย',
    profile: 'โปรไฟล์ผู้เล่น',
    profileHelp: 'การเปลี่ยนสกินจะใช้กับ Profile ID นี้เสมอ',
    preview: 'ตัวอย่างปัจจุบัน',
    rotate: 'ลากเพื่อหมุน',
    edit: 'แก้ไขสกิน',
    reset: 'คืนสกินเริ่มต้น',
    saved: 'สกินที่บันทึกไว้',
    defaults: 'สกินเริ่มต้น',
    add: 'เพิ่มสกิน',
    drop: 'วางไฟล์ PNG ที่นี่',
    useSkin: 'ใช้สกินนี้',
    applyingDefault: 'กำลังใช้สกินเริ่มต้น',
    minecraft: 'โปรไฟล์ Minecraft',
    noSkins: 'ยังไม่มีสกินที่บันทึกไว้',
    offlineTitle: 'สกิน Offline',
    offlineBody: 'สกินนี้จะถูกใส่เฉพาะในเครื่องสำหรับเล่นคนเดียว โดยปกติเซิร์ฟเวอร์ออนไลน์จะไม่แสดงให้ผู้เล่นอื่นเห็น',
    restoreTitle: 'นำเข้าสกินจากผู้เล่น Minecraft',
    restoreBody: 'ใส่ชื่อผู้เล่นหรือวางลิงก์โปรไฟล์ NameMC บัญชี Microsoft จะใช้สกินที่นำเข้าทันที ส่วนบัญชีออฟไลน์จะเก็บไว้ดูในเครื่อง',
    localBadge: 'ออฟไลน์',
    syncedBadge: 'ซิงก์แล้ว',
    restorePlaceholder: 'ชื่อผู้เล่นหรือลิงก์โปรไฟล์ NameMC',
    restore: 'นำเข้าสกิน',
    restoring: 'กำลังค้นหาผู้เล่น',
    restoredOk: 'นำเข้าสกินและใช้งานแล้ว',
    source: 'ต้นทาง',
    onlineBody: 'เมื่อบันทึก สกินจะถูกใช้กับโปรไฟล์ Minecraft จริง กรุณาเข้าเซิร์ฟเวอร์ใหม่เพื่อรีเฟรช',
    signIn: 'เพิ่มโปรไฟล์ผู้เล่น',
    editing: 'กำลังแก้ไขสกิน',
    texture: 'Texture',
    replace: 'เปลี่ยน Texture',
    name: 'ชื่อ Preset',
    arms: 'รูปแบบแขน',
    wide: 'แขนกว้าง',
    slim: 'แขนเล็ก',
    cape: 'ผ้าคลุม',
    none: 'ไม่ใช้',
    cancel: 'ยกเลิก',
    save: 'บันทึกสกิน',
    saving: 'กำลังบันทึก',
    applying: 'กำลังใช้สกิน',
    delete: 'ลบ Preset',
    confirmDelete: 'ลบ Skin Preset นี้หรือไม่?',
    invalid: 'กรุณาเลือกสกิน PNG ขนาด 64x64 หรือแบบเก่า 64x32 และไม่เกิน 2 MB',
    loaded: 'โหลดคลังสกินแล้ว',
    savedOk: 'บันทึกและใช้สกินแล้ว',
    appliedOk: 'ใช้สกินแล้ว',
    resetOk: 'คืนสกินเริ่มต้นแล้ว'
  }
} as const

const classNames = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')

type DefaultSkinOption = {
  id: string
  name: string
  model: 'classic' | 'slim'
  textureUrl: string
}

const DEFAULT_SKIN_ASSET_REVISION = '15b0c1e447cc2fff34ca54d735aaa596a0aab2b0'
const getDefaultSkinTextureUrl = (name: string, model: DefaultSkinOption['model']) => (
  `https://raw.githubusercontent.com/PixiGeko/Minecraft-default-assets/${DEFAULT_SKIN_ASSET_REVISION}/assets/minecraft/textures/entity/player/${model === 'slim' ? 'slim' : 'wide'}/${name.toLowerCase()}.png`
)

const DEFAULT_SKIN_DEFINITIONS: Array<Omit<DefaultSkinOption, 'textureUrl'>> = [
  { id: 'steve', name: 'Steve', model: 'classic' },
  { id: 'alex', name: 'Alex', model: 'slim' },
  { id: 'noor', name: 'Noor', model: 'classic' },
  { id: 'sunny', name: 'Sunny', model: 'slim' },
  { id: 'ari', name: 'Ari', model: 'slim' },
  { id: 'zuri', name: 'Zuri', model: 'classic' },
  { id: 'makena', name: 'Makena', model: 'classic' },
  { id: 'kai', name: 'Kai', model: 'classic' },
  { id: 'efe', name: 'Efe', model: 'slim' }
]
const DEFAULT_SKINS: DefaultSkinOption[] = DEFAULT_SKIN_DEFINITIONS.map((skin) => ({
  ...skin,
  textureUrl: getDefaultSkinTextureUrl(skin.name, skin.model)
}))

const readSkinFile = async (file: File) => {
  if (file.type !== 'image/png' || file.size <= 0 || file.size > 2 * 1024 * 1024) {
    throw new Error('invalid')
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('invalid'))
    reader.readAsDataURL(file)
  })

  await new Promise<void>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      if (image.width === 64 && (image.height === 64 || image.height === 32)) resolve()
      else reject(new Error('invalid'))
    }
    image.onerror = () => reject(new Error('invalid'))
    image.src = dataUrl
  })

  return dataUrl
}

const getCapeFrontCrop = (image: HTMLImageElement) => {
  const scale = image.width >= 64 && image.height >= 32
    ? Math.max(1, Math.min(image.width / 64, image.height / 32))
    : 1
  return {
    x: Math.round(scale),
    y: Math.round(scale),
    width: Math.round(10 * scale),
    height: Math.round(16 * scale)
  }
}

const CapeFront = ({ texture, className = '' }: { texture?: string | null; className?: string }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !texture) return
    const context = canvas.getContext('2d')
    if (!context) return

    const image = new Image()
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.imageSmoothingEnabled = false
      // Minecraft cape atlas: the player-facing/front panel is x=1..10, y=1..16.
      // Scale the crop for high-resolution 2:1 cape textures while preserving crisp pixels.
      const crop = getCapeFrontCrop(image)
      context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height)
    }
    image.src = texture
  }, [texture])

  return (
    <canvas
      ref={canvasRef}
      width={100}
      height={160}
      className={classNames('bg-slate-950 [image-rendering:pixelated]', className)}
    />
  )
}

const SkinAccordion = ({
  title,
  count,
  open,
  onToggle,
  children
}: {
  title: string
  count?: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) => (
  <section className="rounded-xl border border-slate-800 bg-[#0d1526]">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-slate-900/45"
    >
      <span className="flex min-w-0 items-center gap-2">
        <ChevronDown
          size={18}
          className={classNames('shrink-0 text-slate-400 transition-transform', open ? 'rotate-0' : '-rotate-90')}
        />
        <span className="truncate text-base font-black text-slate-100">{title}</span>
      </span>
      {typeof count === 'number' && (
        <span className="ml-3 rounded-md bg-slate-950/55 px-2 py-1 font-mono text-xs font-black text-slate-500">{count}</span>
      )}
    </button>
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="overflow-hidden"
        >
          <div className="border-t border-slate-800 p-5">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  </section>
)

const SkinCard = ({
  name,
  model,
  texture,
  selected,
  busy,
  source,
  primaryLabel,
  onSelect,
  actions
}: {
  name: string
  model: 'classic' | 'slim'
  texture?: string | null
  selected?: boolean
  busy?: boolean
  source?: string | null
  primaryLabel: string
  onSelect: () => void
  actions?: ReactNode
}) => (
  <div
    className={classNames(
      'group relative min-h-[252px] overflow-hidden rounded-2xl border p-3 transition-colors',
      selected
        ? 'border-blue-300/55 bg-[radial-gradient(circle_at_50%_16%,rgba(96,165,250,0.34),rgba(37,99,235,0.28)_42%,rgba(13,21,38,0.94)_78%)] shadow-[0_18px_42px_rgba(37,99,235,0.16)]'
        : 'border-slate-800/70 bg-slate-950/10 hover:border-blue-400/35 hover:bg-slate-900/45'
    )}
  >
    <button
      type="button"
      onClick={onSelect}
      disabled={busy || selected}
      className="relative flex h-[170px] w-full items-start justify-center overflow-visible bg-transparent text-center outline-none disabled:cursor-default"
    >
      {texture ? (
        <StaticSkinPreview
          skin={texture}
          model={model}
          alt={`${name} skin preview`}
          className="pointer-events-none h-full w-full border-0 bg-transparent shadow-none outline-none"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-600">
          <User size={28} />
        </div>
      )}
      {busy && (
        <span className="absolute inset-0 flex items-center justify-center bg-slate-950/75">
          <Loader2 size={22} className="animate-spin text-blue-300" />
        </span>
      )}
    </button>
    <div className="mt-3 min-w-0 text-center">
      <p className="truncate text-sm font-black text-slate-100">{name}</p>
      <p className="mt-1 text-[11px] font-bold capitalize text-slate-500">{model} arms</p>
      {source && (
        <p className="mt-1 truncate text-[10px] font-black uppercase tracking-[0.1em] text-blue-300">{source}</p>
      )}
    </div>
    <div className="mt-3 grid gap-2">
      <button
        type="button"
        onClick={onSelect}
        disabled={busy || selected}
        className={classNames(
          'flex h-8 items-center justify-center gap-1.5 rounded-md border text-[11px] font-black transition-colors',
          selected
            ? 'border-blue-300/45 bg-blue-400/15 text-blue-100'
            : 'border-slate-700 text-slate-300 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-100',
          busy && 'cursor-wait opacity-70'
        )}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
        {primaryLabel}
      </button>
      {actions}
    </div>
  </div>
)

const SkinPage = ({
  accounts,
  activeAccountId,
  language,
  onRequestLogin,
  onStatus,
  onLibraryChange
}: SkinPageProps) => {
  const text = copy[language]
  const [library, setLibrary] = useState<SkinLibraryData | null>(null)
  const applyLibrary = (next: SkinLibraryData) => {
    setLibrary(next)
    onLibraryChange?.(next)
  }
  const [loading, setLoading] = useState(false)
  const [busySkinId, setBusySkinId] = useState<string | null>(null)
  const [draft, setDraft] = useState<SkinDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [restoreName, setRestoreName] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [savedOpen, setSavedOpen] = useState(true)
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const [busyDefaultSkinId, setBusyDefaultSkinId] = useState<string | null>(null)
  const [skinDeleteTargetId, setSkinDeleteTargetId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const editorFileInputRef = useRef<HTMLInputElement | null>(null)
  const libraryRequestRef = useRef(0)

  const activeAccount = accounts.find((account) => account.id === activeAccountId) || null
  const selectedSkin = useMemo(() => {
    if (!library) return null
    const defaultSkin = library.activeDefaultSkinId
      ? DEFAULT_SKINS.find((skin) => skin.id === library.activeDefaultSkinId)
      : null
    if (defaultSkin) {
      return {
        id: `default:${defaultSkin.id}`,
        name: defaultSkin.name,
        model: defaultSkin.model,
        textureDataUrl: defaultSkin.textureUrl,
        source: 'default'
      } as SkinPreset
    }
    return library.savedSkins.find((skin) => skin.id === library.selectedSkinId)
      || (library.currentSkin?.id === library.selectedSkinId ? library.currentSkin : null)
      || library.currentSkin
      || null
  }, [library])
  const selectedCapeTexture = selectedSkin?.capeTextureDataUrl
    || library?.capes.find((cape) => cape.id === (selectedSkin?.capeId ?? library.activeCapeId))?.textureDataUrl
    || null
  const profileSkinInSavedLibrary = Boolean(library?.currentSkin && library.savedSkins.some((skin) => skin.id === library.currentSkin?.id))
  const savedSkinCount = (library?.savedSkins.length || 0) + (library?.currentSkin && !profileSkinInSavedLibrary ? 1 : 0)

  const loadLibrary = async (accountId: string, quiet = false) => {
    const requestId = ++libraryRequestRef.current
    setLoading(true)
    try {
      const cached = await window.electron.getSkinLibrary(accountId)
      if (requestId !== libraryRequestRef.current) return
      applyLibrary(cached)
      setLoading(false)
      if (!quiet) onStatus(cached.warning || text.loaded)

      try {
        const refreshed = await window.electron.refreshSkinLibrary(accountId)
        if (requestId !== libraryRequestRef.current) return
        applyLibrary(refreshed)
        if (!quiet && refreshed.warning) onStatus(refreshed.warning)
      } catch (error: any) {
        if (!quiet && requestId === libraryRequestRef.current) {
          onStatus(`Error: ${error.message || 'Could not refresh skin library'}`)
        }
      }
    } catch (error: any) {
      if (requestId !== libraryRequestRef.current) return
      setLibrary(null)
      onStatus(`Error: ${error.message || 'Could not load skin library'}`)
    } finally {
      if (requestId === libraryRequestRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!activeAccountId) {
      libraryRequestRef.current += 1
      setLibrary(null)
      return
    }
    void loadLibrary(activeAccountId, true)
  }, [activeAccountId])

  useEffect(() => {
    if (!draft) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setDraft(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [draft, saving])

  const openFileAsDraft = async (file?: File | null) => {
    if (!file) return
    try {
      const textureDataUrl = await readSkinFile(file)
      setDraft({
        name: file.name.replace(/\.png$/i, '').slice(0, 48) || 'Imported skin',
        model: 'classic',
        textureDataUrl,
        capeId: library?.activeCapeId || null
      })
    } catch {
      onStatus(text.invalid)
    }
  }

  const editSkin = (skin: SkinPreset) => {
    setDraft({
      skinId: library?.savedSkins.some((item) => item.id === skin.id) ? skin.id : undefined,
      name: skin.source === 'minecraft' ? `${activeAccount?.name || 'Minecraft'} skin` : skin.name,
      model: skin.model,
      textureDataUrl: skin.textureDataUrl,
      capeId: skin.capeId ?? library?.activeCapeId ?? null,
      capeTextureDataUrl: skin.capeTextureDataUrl ?? null,
      sourceProfileName: skin.sourceProfileName ?? null
    })
  }

  const importPlayerSkin = async () => {
    const playerName = restoreName.trim()
    if (!activeAccountId || !playerName || restoring) return
    setRestoring(true)
    onStatus(text.restoring)
    try {
      const next = await window.electron.importSkinByName({ accountId: activeAccountId, playerName })
      applyLibrary(next)
      setRestoreName('')
      onStatus(text.restoredOk)
    } catch (error: any) {
      onStatus(`Error: ${error.message || 'Could not restore player skin'}`)
    } finally {
      setRestoring(false)
    }
  }

  const saveDraft = async () => {
    if (!draft || !activeAccountId) return
    setSaving(true)
    try {
      const next = await window.electron.saveSkinPreset({
        accountId: activeAccountId,
        skinId: draft.skinId,
        name: draft.name,
        model: draft.model,
        textureDataUrl: draft.textureDataUrl,
        capeId: draft.capeId,
        activate: true
      })
      applyLibrary(next)
      setDraft(null)
      onStatus(next.warning || text.savedOk)
    } catch (error: any) {
      onStatus(`Error: ${error.message || 'Could not save skin'}`)
    } finally {
      setSaving(false)
    }
  }

  const activateSkin = async (skinId: string) => {
    if (!activeAccountId || busySkinId || library?.selectedSkinId === skinId) return
    setBusySkinId(skinId)
    onStatus(text.applying)
    try {
      const next = await window.electron.activateSkinPreset({ accountId: activeAccountId, skinId })
      applyLibrary(next)
      onStatus(next.warning || text.appliedOk)
    } catch (error: any) {
      onStatus(`Error: ${error.message || 'Could not apply skin'}`)
    } finally {
      setBusySkinId(null)
    }
  }

  const activateDefaultSkin = async (skin: DefaultSkinOption) => {
    if (!activeAccountId || busySkinId || busyDefaultSkinId || library?.activeDefaultSkinId === skin.id) return
    setBusyDefaultSkinId(skin.id)
    onStatus(text.applyingDefault)
    try {
      const next = await window.electron.saveDefaultSkinPreset({ accountId: activeAccountId, defaultSkinId: skin.id })
      applyLibrary(next)
      onStatus(next.warning || text.appliedOk)
    } catch (error: any) {
      onStatus(`Error: ${error.message || 'Could not apply default skin'}`)
    } finally {
      setBusyDefaultSkinId(null)
    }
  }

  const deleteSkin = (skinId: string) => {
    if (!activeAccountId || busySkinId) return
    setSkinDeleteTargetId(skinId)
  }

  const confirmDeleteSkin = async () => {
    if (!activeAccountId || busySkinId || !skinDeleteTargetId) return
    const skinId = skinDeleteTargetId
    setBusySkinId(skinId)
    try {
      const next = await window.electron.deleteSkinPreset({ accountId: activeAccountId, skinId })
      applyLibrary(next)
      onStatus(text.delete)
      setSkinDeleteTargetId(null)
    } catch (error: any) {
      onStatus(`Error: ${error.message || 'Could not delete skin'}`)
    } finally {
      setBusySkinId(null)
    }
  }

  const resetSkin = async () => {
    if (!activeAccountId || busySkinId) return
    setBusySkinId('reset')
    try {
      const next = await window.electron.resetActiveSkin({ accountId: activeAccountId })
      applyLibrary(next)
      onStatus(next.warning || text.resetOk)
    } catch (error: any) {
      onStatus(`Error: ${error.message || 'Could not reset skin'}`)
    } finally {
      setBusySkinId(null)
    }
  }

  if (!activeAccount) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex min-h-[520px] items-center justify-center rounded-xl border border-slate-800 bg-[#0d1526]"
      >
        <div className="max-w-md text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-400/25 bg-blue-500/10 text-blue-200">
            <User size={28} />
          </div>
          <h2 className="mt-5 text-2xl font-black">{text.title}</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">{text.subtitle}</p>
          <button onClick={onRequestLogin} className="mt-6 h-11 rounded-lg bg-blue-500 px-5 text-sm font-black text-white hover:bg-blue-400">
            {text.signIn}
          </button>
        </div>
      </motion.section>
    )
  }

  return (
    <>
      <AnimatePresence>
        {skinDeleteTargetId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !busySkinId) setSkinDeleteTargetId(null)
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="skin-delete-title"
              className="w-full max-w-md overflow-hidden rounded-lg border border-slate-700 bg-[#0d1526] shadow-2xl shadow-black/50"
            >
              <header className="flex items-start gap-4 border-b border-slate-800 p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-red-400/30 bg-red-500/12 text-red-100">
                  <Trash2 size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 id="skin-delete-title" className="text-lg font-black text-white">{text.delete}</h2>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-400">{text.confirmDelete}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSkinDeleteTargetId(null)}
                  disabled={Boolean(busySkinId)}
                  aria-label={text.cancel}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:bg-slate-800 hover:text-slate-100 disabled:cursor-wait disabled:opacity-45"
                >
                  <X size={17} />
                </button>
              </header>
              <footer className="flex flex-col-reverse gap-2 p-5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setSkinDeleteTargetId(null)}
                  disabled={Boolean(busySkinId)}
                  className="flex h-10 items-center justify-center rounded-md border border-slate-700 bg-slate-900 px-4 text-sm font-black text-slate-200 transition-colors duration-150 hover:border-slate-500 hover:bg-slate-800 disabled:cursor-wait disabled:opacity-45"
                >
                  {text.cancel}
                </button>
                <button
                  type="button"
                  onClick={() => void confirmDeleteSkin()}
                  disabled={Boolean(busySkinId)}
                  className="flex h-10 items-center justify-center gap-2 rounded-md bg-red-500 px-4 text-sm font-black text-white transition-colors duration-150 hover:bg-red-400 disabled:cursor-wait disabled:opacity-60"
                >
                  {busySkinId === skinDeleteTargetId && <Loader2 size={16} className="animate-spin" />}
                  {text.delete}
                </button>
              </footer>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-5"
      >
        <div className="rounded-xl border border-slate-800 bg-[#0d1526] p-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-black tracking-tight">{text.title}</h2>
              <span className="rounded-full border border-blue-400/25 bg-blue-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-blue-200">
                Beta
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm font-semibold text-slate-500">{text.subtitle}</p>
          </div>
        </div>

        <div className={classNames(
          'flex items-start gap-3 rounded-lg border p-4',
          library?.offlineOnly
            ? 'border-amber-400/25 bg-amber-500/[0.07] text-amber-100'
            : 'border-blue-400/20 bg-blue-500/[0.06] text-blue-100'
        )}>
          {library?.offlineOnly ? <ShieldAlert size={19} className="mt-0.5 shrink-0 text-amber-300" /> : <Cloud size={19} className="mt-0.5 shrink-0 text-blue-300" />}
          <div>
            <p className="text-sm font-black">{library?.offlineOnly ? text.offlineTitle : text.minecraft}</p>
            <p className="mt-1 text-xs font-semibold leading-5 opacity-70">
              {library?.offlineOnly ? text.offlineBody : text.onlineBody}
            </p>
            {library?.warning && <p className="mt-2 text-xs font-black text-amber-300">{library.warning}</p>}
          </div>
        </div>

        {library && (
          <div className="rounded-xl border border-blue-400/20 bg-[linear-gradient(135deg,rgba(37,99,235,0.12),rgba(13,21,38,0.96)_58%)] p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-blue-400/25 bg-blue-500/10 text-blue-200">
                  <Download size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-100">{text.restoreTitle}</h3>
                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{text.restoreBody}</p>
                </div>
              </div>
              <div className="flex min-w-0 gap-2 lg:w-[420px]">
                <input
                  value={restoreName}
                  onChange={(event) => setRestoreName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void importPlayerSkin()
                  }}
                  maxLength={180}
                  disabled={restoring}
                  placeholder={text.restorePlaceholder}
                  className="h-11 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950/40 px-3 text-sm font-black text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-400/60 disabled:opacity-60"
                />
                <button
                  disabled={restoring || !restoreName.trim()}
                  onClick={importPlayerSkin}
                  className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 text-xs font-black text-white hover:bg-blue-400 disabled:cursor-wait disabled:opacity-50"
                >
                  {restoring ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                  {restoring ? text.restoring : text.restore}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-0 lg:self-start">
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-[radial-gradient(circle_at_50%_22%,rgba(59,130,246,0.18),transparent_38%),linear-gradient(180deg,#111c32,#0d1526)]">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{text.preview}</p>
                  <p className="mt-1 max-w-[220px] truncate text-sm font-black text-slate-100">{activeAccount.name}</p>
                </div>
                {library?.offlineOnly ? (
                  <span className="rounded-md bg-amber-500/10 px-2 py-1 text-[10px] font-black uppercase text-amber-300">{text.localBadge}</span>
                ) : (
                  <span className="rounded-md bg-blue-500/10 px-2 py-1 text-[10px] font-black uppercase text-blue-200">{text.syncedBadge}</span>
                )}
              </div>

              <div className="relative h-[390px]">
                {loading ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 size={24} className="animate-spin text-blue-300" />
                  </div>
                ) : selectedSkin ? (
                  <SkinViewer
                    skin={selectedSkin.textureDataUrl}
                    cape={selectedCapeTexture}
                    model={selectedSkin.model}
                    className="h-full w-full"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600">
                    <ImagePlus size={38} />
                    <p className="mt-3 text-xs font-black">{text.noSkins}</p>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-800 p-4">
                <div className="flex items-center justify-center gap-2 text-xs font-bold text-slate-500">
                  <Rotate3D size={15} />
                  {text.rotate}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    disabled={!selectedSkin}
                    onClick={() => selectedSkin && editSkin(selectedSkin)}
                    className="flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-700 text-xs font-black text-slate-200 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200 disabled:opacity-40"
                  >
                    <Edit3 size={15} />
                    {text.edit}
                  </button>
                  <button
                    disabled={busySkinId === 'reset'}
                    onClick={resetSkin}
                    className="flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-700 text-xs font-black text-slate-400 hover:border-slate-600 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40"
                  >
                    {busySkinId === 'reset' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                    {text.reset}
                  </button>
                </div>
              </div>
            </div>
          </aside>

          <div className="min-w-0 space-y-5">
            <SkinAccordion
              title={text.saved}
              count={savedSkinCount}
              open={savedOpen}
              onToggle={() => setSavedOpen((value) => !value)}
            >

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png"
                className="sr-only"
                onChange={(event) => {
                  void openFileAsDraft(event.target.files?.[0])
                  event.currentTarget.value = ''
                }}
              />

              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={(event) => {
                    event.preventDefault()
                    setDragging(true)
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault()
                    setDragging(false)
                    void openFileAsDraft(event.dataTransfer.files?.[0])
                  }}
                  className={classNames(
                    'flex min-h-[252px] flex-col items-center justify-center rounded-2xl border border-dashed p-5 text-center transition-colors',
                    dragging
                      ? 'border-blue-300 bg-blue-500/15 text-blue-100'
                      : 'border-slate-700 bg-slate-950/20 text-slate-500 hover:border-blue-400/50 hover:bg-blue-500/[0.06] hover:text-blue-200'
                  )}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-current/20 bg-current/5">
                    <ImagePlus size={22} />
                  </div>
                  <p className="mt-4 text-sm font-black">{text.add}</p>
                  <p className="mt-1 text-xs font-semibold opacity-60">{text.drop}</p>
                  <span className="mt-4 rounded-md border border-current/20 px-2 py-1 font-mono text-[10px] font-black">64 × 64 PNG</span>
                </button>

                {library?.currentSkin && !profileSkinInSavedLibrary && (
                  <SkinCard
                    name={activeAccount.name}
                    model={library.currentSkin.model}
                    texture={library.currentSkin.textureDataUrl}
                    selected={library.currentSkin.id === library.selectedSkinId && !library.activeDefaultSkinId}
                    source={text.minecraft}
                    primaryLabel={library.currentSkin.id === library.selectedSkinId && !library.activeDefaultSkinId ? text.appliedOk : text.useSkin}
                    onSelect={() => library.currentSkin && void activateSkin(library.currentSkin.id)}
                    actions={(
                      <button
                        type="button"
                        onClick={() => library.currentSkin && editSkin(library.currentSkin)}
                        className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-700 text-[11px] font-black text-slate-300 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200"
                      >
                        <Edit3 size={13} />
                        {text.edit}
                      </button>
                    )}
                  />
                )}

                {library?.savedSkins.map((skin) => {
                  const selected = skin.id === library.selectedSkinId && !library.activeDefaultSkinId
                  const busy = busySkinId === skin.id
                  return (
                    <SkinCard
                      key={skin.id}
                      name={skin.name}
                      model={skin.model}
                      texture={skin.textureDataUrl}
                      selected={selected}
                      busy={busy}
                      source={skin.sourceProfileName ? `${text.source}: ${skin.sourceProfileName}` : null}
                      primaryLabel={selected ? text.appliedOk : text.useSkin}
                      onSelect={() => void activateSkin(skin.id)}
                      actions={(
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => editSkin(skin)}
                            className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-700 text-[11px] font-black text-slate-300 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200"
                          >
                            <Edit3 size={13} />
                            {text.edit}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteSkin(skin.id)}
                            className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-700 text-[11px] font-black text-slate-500 hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300"
                          >
                            <Trash2 size={13} />
                            {text.delete}
                          </button>
                        </div>
                      )}
                    />
                  )
                })}
              </div>
            </SkinAccordion>

            <SkinAccordion
              title={text.defaults}
              count={DEFAULT_SKINS.length}
              open={defaultsOpen}
              onToggle={() => setDefaultsOpen((value) => !value)}
            >
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {DEFAULT_SKINS.map((skin) => {
                  const selected = library?.activeDefaultSkinId === skin.id
                  return (
                    <SkinCard
                      key={skin.id}
                      name={skin.name}
                      model={skin.model}
                      texture={skin.textureUrl}
                      selected={selected}
                      busy={busyDefaultSkinId === skin.id}
                      primaryLabel={selected ? text.appliedOk : text.useSkin}
                      onSelect={() => void activateDefaultSkin(skin)}
                    />
                  )
                })}
              </div>
            </SkinAccordion>
          </div>
        </div>
      </motion.section>

      <AnimatePresence>
        {draft && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
            onMouseDown={() => !saving && setDraft(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.99 }}
              onMouseDown={(event) => event.stopPropagation()}
              className="max-h-[calc(100vh-32px)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-[#111a2c] shadow-2xl shadow-black/60"
            >
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
                <div>
                  <h3 className="text-lg font-black">{text.editing}</h3>
                  <p className="mt-1 truncate font-mono text-[10px] font-semibold text-slate-600">{activeAccount.uuid}</p>
                </div>
                <button
                  disabled={saving}
                  onClick={() => setDraft(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40"
                  data-tooltip="Close"
                  aria-label="Close skin editor"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="grid gap-6 p-5 md:grid-cols-[300px_minmax(0,1fr)]">
                <div>
                  <div className="h-[400px] overflow-hidden rounded-xl border border-slate-800 bg-[radial-gradient(circle_at_50%_25%,rgba(59,130,246,0.2),transparent_42%),#0b1322]">
                    <SkinViewer
                      skin={draft.textureDataUrl}
                      cape={library?.offlineOnly
                        ? draft.capeTextureDataUrl || undefined
                        : draft.capeId
                          ? library?.capes.find((cape) => cape.id === draft.capeId)?.textureDataUrl || draft.capeTextureDataUrl || undefined
                          : undefined}
                      model={draft.model}
                      autoRotate
                      className="h-full w-full"
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-center gap-2 text-xs font-bold text-slate-500">
                    <Rotate3D size={15} />
                    {text.rotate}
                  </div>
                </div>

                <div className="space-y-5">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{text.texture}</p>
                    <input
                      ref={editorFileInputRef}
                      type="file"
                      accept="image/png"
                      className="sr-only"
                      onChange={async (event) => {
                        const file = event.target.files?.[0]
                        event.currentTarget.value = ''
                        if (!file) return
                        try {
                          const textureDataUrl = await readSkinFile(file)
                          setDraft((current) => current ? {
                            ...current,
                            textureDataUrl,
                            name: current.skinId ? current.name : (file.name.replace(/\.png$/i, '').slice(0, 48) || current.name)
                          } : current)
                        } catch {
                          onStatus(text.invalid)
                        }
                      }}
                    />
                    <button
                      onClick={() => editorFileInputRef.current?.click()}
                      className="mt-2 flex h-10 items-center gap-2 rounded-lg border border-slate-700 px-3 text-xs font-black text-slate-300 hover:border-blue-400/50 hover:bg-blue-500/10 hover:text-blue-200"
                    >
                      <Upload size={15} />
                      {text.replace}
                    </button>
                  </div>

                  <label className="block">
                    <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{text.name}</span>
                    <input
                      value={draft.name}
                      maxLength={48}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      className="mt-2 h-11 w-full rounded-lg border border-slate-700 bg-slate-950/35 px-3 text-sm font-black text-slate-100 outline-none focus:border-blue-400/60"
                    />
                  </label>

                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{text.arms}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {([
                        { id: 'classic', label: text.wide },
                        { id: 'slim', label: text.slim }
                      ] as const).map((option) => (
                        <button
                          key={option.id}
                          onClick={() => setDraft({ ...draft, model: option.id })}
                          className={classNames(
                            'flex h-11 items-center justify-center gap-2 rounded-lg border text-xs font-black',
                            draft.model === option.id
                              ? 'border-blue-400/50 bg-blue-500/15 text-blue-100'
                              : 'border-slate-700 text-slate-500 hover:bg-slate-800 hover:text-slate-200'
                          )}
                        >
                          <span className={classNames(
                            'h-4 w-4 rounded-full border',
                            draft.model === option.id ? 'border-blue-300 bg-blue-400 shadow-[inset_0_0_0_3px_#111a2c]' : 'border-slate-600'
                          )} />
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{text.cape}</p>
                    {library?.offlineOnly ? (
                      <div className="mt-2 flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/25 p-3 text-xs font-semibold leading-5 text-slate-500">
                        {draft.capeTextureDataUrl && (
                          <CapeFront texture={draft.capeTextureDataUrl} className="h-20 w-[50px] shrink-0 rounded-md border border-slate-700" />
                        )}
                        <span>
                          {draft.sourceProfileName ? `${text.source}: ${draft.sourceProfileName}. ` : ''}
                          {text.offlineBody}
                        </span>
                      </div>
                    ) : (
                      <div className="mt-2 grid grid-cols-4 gap-2">
                        <button
                          onClick={() => setDraft({ ...draft, capeId: null, capeTextureDataUrl: null })}
                          className={classNames(
                            'flex aspect-[5/8] flex-col items-center justify-center rounded-lg border text-[10px] font-black',
                            draft.capeId === null
                              ? 'border-blue-400/60 bg-blue-500/15 text-blue-100'
                              : 'border-slate-700 bg-slate-950/25 text-slate-500 hover:border-slate-600'
                          )}
                        >
                          <X size={16} />
                          <span className="mt-2">{text.none}</span>
                        </button>
                        {library?.capes.map((cape) => (
                          <button
                            key={cape.id}
                            onClick={() => setDraft({ ...draft, capeId: cape.id, capeTextureDataUrl: cape.textureDataUrl })}
                            data-tooltip={cape.name}
                            aria-label={cape.name}
                            className={classNames(
                              'nam-allow-overflow relative aspect-[5/8] overflow-visible rounded-lg border',
                              draft.capeId === cape.id
                                ? 'border-blue-300 bg-blue-500/15 ring-2 ring-blue-500/20'
                                : 'border-slate-700 bg-slate-950/25 hover:border-slate-600'
                            )}
                          >
                            <CapeFront texture={cape.textureDataUrl} className="h-full w-full rounded-lg" />
                            {draft.capeId === cape.id && (
                              <span className="absolute -right-2 -top-2 z-20 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#111a2c] bg-blue-500 text-white shadow-lg shadow-blue-950/40 ring-2 ring-blue-300/25">
                                <Check size={11} strokeWidth={3} />
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-4">
                <button
                  disabled={saving}
                  onClick={() => setDraft(null)}
                  className="flex h-10 items-center gap-2 rounded-lg border border-slate-700 px-4 text-xs font-black text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                >
                  <X size={15} />
                  {text.cancel}
                </button>
                <button
                  disabled={saving || !draft.name.trim()}
                  onClick={saveDraft}
                  className="flex h-10 min-w-[130px] items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 text-xs font-black text-white hover:bg-blue-400 disabled:cursor-wait disabled:opacity-50"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? text.saving : text.save}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

export default SkinPage
