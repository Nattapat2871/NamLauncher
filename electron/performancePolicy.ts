// Author/creator: nattapat2871 (https://nattapat2871.me)

export type PerformanceProfile = 'automatic' | 'low-spec' | 'balanced' | 'max-fps'

export type PerformancePolicyInput = {
  totalMemoryGb: number
  requestedMemoryGb?: number | null
  automaticMemory: boolean
  profile: PerformanceProfile
  minecraftVersion?: string
  loader?: string
}

export type PerformancePolicy = {
  profile: PerformanceProfile
  memoryMax: string
  memoryMin: string
  memoryGb: number
  heapMaxMb: number
  nativeMemoryReserveMb: number
  launcherMemoryReserveMb: number
  safeMaximumGb: number
  recommendedMemoryGb: number
  javaArgs: string[]
}

export type CustomJavaArgumentPolicy = Readonly<{
  javaArgs: string[]
  removedArguments: string[]
}>

// These are server-oriented or fixed-layout GC options. On a graphical client
// they either commit memory eagerly, prevent Minecraft from requesting cleanup
// after a resource reload, or replace the JVM's adaptive sizing with fixed
// values. Keep custom arguments useful, but do not let copied server flag packs
// turn a small, elastic client heap into a large resident process.
const CLIENT_MEMORY_PRESSURE_FLAGS = [
  /^-XX:(?:\+AlwaysPreTouch|AlwaysPreTouch=(?:true|1))$/i,
  /^-XX:(?:\+UseNUMA|UseNUMA=(?:true|1))$/i,
  /^-XX:(?:\+DisableExplicitGC|DisableExplicitGC=(?:true|1))$/i,
  /^-XX:(?:G1HeapRegionSize|G1NewSizePercent|G1MaxNewSizePercent|G1ReservePercent|G1HeapWastePercent|G1MixedGCCountTarget|InitiatingHeapOccupancyPercent|MaxGCPauseMillis)=/i
]

// Heap sizing belongs to the launcher memory budget. Accepting a second heap
// limit from instance metadata or custom arguments makes the final value depend
// on argument ordering and can silently exceed the amount selected in the UI.
const MANAGED_HEAP_ARGUMENTS = [
  /^-Xm(?:s|x)/i,
  /^-XX:(?:InitialRAMPercentage|MinRAMPercentage|MaxRAMPercentage|MaxRAM|SoftMaxHeapSize)=/i
]

const clamp = (value: number, minimum: number, maximum: number) => (
  Math.min(Math.max(value, minimum), maximum)
)

export const normalizePerformanceProfile = (value: unknown): PerformanceProfile => {
  if (value === 'low-spec' || value === 'balanced' || value === 'max-fps') return value
  return 'automatic'
}

export const getSafeMaximumMemoryGb = (totalMemoryGb: number) => {
  if (!Number.isFinite(totalMemoryGb) || totalMemoryGb <= 0) return 32

  const reserveGb = totalMemoryGb <= 4
    ? 1.5
    : totalMemoryGb <= 8
      ? 2.5
      : totalMemoryGb <= 16
        ? 4
        : 6

  return clamp(Math.floor(totalMemoryGb - reserveGb), 1, 32)
}

export const getRecommendedMemoryGb = (
  totalMemoryGb: number,
  profile: PerformanceProfile = 'automatic',
  loader = 'vanilla'
) => {
  const total = Number.isFinite(totalMemoryGb) && totalMemoryGb > 0 ? totalMemoryGb : 8
  const safeMaximum = getSafeMaximumMemoryGb(total)
  let target = total <= 4
    ? 2
    : total <= 6
      ? 3
      : total <= 8
        ? 4
        : total <= 12
          ? 5
          : total <= 16
            ? 6
            : total <= 24
              ? 8
              : 10

  if (loader && loader !== 'vanilla' && total >= 8) target += 1
  if (profile === 'low-spec') target = Math.min(target, 4)
  if (profile === 'balanced') target = Math.min(target, 8)
  if (profile === 'max-fps') target = Math.min(Math.max(target, total >= 16 ? 8 : 4), 12)

  return clamp(Math.round(target), 1, safeMaximum)
}

const getMinecraftMinorVersion = (minecraftVersion: string) => {
  const calendarVersion = String(minecraftVersion || '').match(/^(\d{2,})(?:\.|$)/)
  if (calendarVersion) return Number(calendarVersion[1]) >= 26 ? 21 : 0
  const releaseVersion = String(minecraftVersion || '').match(/^1\.(\d+)/)
  return releaseVersion ? Number(releaseVersion[1]) : 0
}

export const getPerformanceJavaArgs = (
  profile: PerformanceProfile,
  minecraftVersion = ''
) => {
  if (profile === 'automatic') return []

  const modernJavaRuntime = getMinecraftMinorVersion(minecraftVersion) >= 17
  if (profile === 'low-spec') {
    return modernJavaRuntime
      ? ['-XX:+UseG1GC', '-XX:+UseStringDeduplication']
      : ['-XX:+UseG1GC']
  }

  if (profile === 'max-fps') {
    return [
      '-XX:+UseG1GC',
      '-XX:MaxGCPauseMillis=200',
      '-XX:+ParallelRefProcEnabled'
    ]
  }

  return modernJavaRuntime ? ['-XX:+UseG1GC'] : []
}

export const applyCustomJavaArgumentPolicy = (
  javaArgs: readonly string[],
  _platform: NodeJS.Platform
): CustomJavaArgumentPolicy => {
  const safeArguments: string[] = []
  const removedArguments: string[] = []
  for (const argument of javaArgs) {
    const overridesManagedHeap = MANAGED_HEAP_ARGUMENTS.some((pattern) => pattern.test(argument))
    const createsClientMemoryPressure = CLIENT_MEMORY_PRESSURE_FLAGS.some((pattern) => pattern.test(argument))
    if (overridesManagedHeap || createsClientMemoryPressure) {
      removedArguments.push(argument)
    } else {
      safeArguments.push(argument)
    }
  }
  return { javaArgs: safeArguments, removedArguments }
}

const getSessionMemoryReserves = (memoryGb: number) => {
  const nativeMemoryReserveMb = memoryGb <= 1
    ? 128
    : memoryGb <= 2
      ? 256
    : memoryGb <= 4
      ? 512
      : memoryGb <= 6
        ? 1024
        : memoryGb <= 8
          ? 1536
          : 2048
  const launcherMemoryReserveMb = memoryGb <= 1 ? 128 : 256
  const totalBudgetMb = memoryGb * 1024
  const heapMaxMb = totalBudgetMb - nativeMemoryReserveMb - launcherMemoryReserveMb
  return { heapMaxMb, nativeMemoryReserveMb, launcherMemoryReserveMb }
}

export const resolvePerformancePolicy = (input: PerformancePolicyInput): PerformancePolicy => {
  const profile = normalizePerformanceProfile(input.profile)
  const safeMaximumGb = getSafeMaximumMemoryGb(input.totalMemoryGb)
  const recommendedMemoryGb = getRecommendedMemoryGb(
    input.totalMemoryGb,
    profile,
    input.loader
  )
  const requestedMemoryGb = Number(input.requestedMemoryGb)
  const memoryGb = input.automaticMemory || !Number.isFinite(requestedMemoryGb)
    ? recommendedMemoryGb
    : clamp(Math.round(requestedMemoryGb), 1, safeMaximumGb)
  const { heapMaxMb, nativeMemoryReserveMb, launcherMemoryReserveMb } = getSessionMemoryReserves(memoryGb)

  // Xms is only the startup floor, not a performance target. A small floor lets
  // the heap grow on demand instead of committing 1-2 GB before the title
  // screen and is especially important while a large server pack is reloaded.
  const minimumMemoryMb = Math.min(heapMaxMb, memoryGb <= 1 ? 256 : 512)

  return {
    profile,
    memoryMax: `${heapMaxMb}M`,
    memoryMin: `${minimumMemoryMb}M`,
    memoryGb,
    heapMaxMb,
    nativeMemoryReserveMb,
    launcherMemoryReserveMb,
    safeMaximumGb,
    recommendedMemoryGb,
    javaArgs: getPerformanceJavaArgs(profile, input.minecraftVersion)
  }
}
