// Author/creator: nattapat2871 (https://nattapat2871.me)

export type MinecraftCrashDiagnosis = {
  code:
    | 'graphics-memory'
    | 'jvm-native-memory'
    | 'incompatible-mod-mixin'
    | 'missing-mod-dependency'
    | 'incompatible-mod-dependency'
  culpritMod?: string
  dependencyId?: string
  installedVersion?: string
  requiredVersion?: string
  dependentMods?: string[]
}

const normalizeCulpritMod = (value: string) => {
  const normalized = value.trim().toLowerCase()
  return /^[a-z0-9_.-]{1,64}$/.test(normalized) ? normalized : ''
}

const normalizeVersionRequirement = (value: string) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= 96 && /^[a-z0-9+*<>=~^|,._ -]+$/i.test(normalized)
    ? normalized
    : ''
}

const getDependentMods = (error: string, dependencyId: string) => {
  const escapedDependencyId = dependencyId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const dependencyToken = new RegExp(`(?:^|[^a-z0-9_.-])${escapedDependencyId}(?=$|[^a-z0-9_.-])`, 'i')
  const dependentMods = [...error.matchAll(/Mod '[^'\r\n]+' \(([a-z0-9_.-]+)\)[^\r\n]*?\brequires\b([^\r\n]*)/gi)]
    .filter((match) => dependencyToken.test(match[2]))
    .map((match) => normalizeCulpritMod(match[1]))
    .filter(Boolean)
  return [...new Set(dependentMods)].slice(0, 8)
}

const normalizeSolutionLineVersion = (value: string) => (
  normalizeVersionRequirement(
    value
      .replace(/\s+that is compatible with:\s*$/i, '')
      .replace(/[.!]\s*$/, '')
  )
)

export const getMinecraftCrashDiagnosis = (rawError: unknown): MinecraftCrashDiagnosis | null => {
  const error = String(rawError || '')

  if (/The paging file is too small|insufficient memory for the Java Runtime Environment|Native memory allocation[^\r\n]{0,160}failed|os::commit_memory[^\r\n]{0,200}failed|DOS error\/errno=1455/i.test(error)) {
    return { code: 'jvm-native-memory' }
  }

  if (
    /\bGL_OUT_OF_MEMORY\b/i.test(error)
    || (/Failed to map buffer/i.test(error) && /(?:GlBuffer|OpenGL|GpuDevice)/i.test(error))
  ) {
    return { code: 'graphics-memory' }
  }

  const incompatibleDependencyMatch = error.match(
    /Replace mod '[^'\r\n]+' \(([a-z0-9_.-]+)\)\s+([^\s!\r\n]+)\s+with version\s+([^\r\n]+)/i
  )
  if (incompatibleDependencyMatch) {
    const dependencyId = normalizeCulpritMod(incompatibleDependencyMatch[1])
    const installedVersion = normalizeVersionRequirement(incompatibleDependencyMatch[2])
    const requiredVersion = normalizeSolutionLineVersion(incompatibleDependencyMatch[3])
    if (dependencyId && installedVersion && requiredVersion) {
      return {
        code: 'incompatible-mod-dependency',
        dependencyId,
        installedVersion,
        requiredVersion,
        dependentMods: getDependentMods(error, dependencyId)
      }
    }
  }

  const missingDependencyMatch = error.match(
    /Install\s+([a-z0-9_.-]+),\s+version\s+([^\r\n]+)/i
  )
  if (missingDependencyMatch) {
    const dependencyId = normalizeCulpritMod(missingDependencyMatch[1])
    const requiredVersion = normalizeSolutionLineVersion(missingDependencyMatch[2])
    if (dependencyId && requiredVersion) {
      return {
        code: 'missing-mod-dependency',
        dependencyId,
        requiredVersion,
        dependentMods: getDependentMods(error, dependencyId)
      }
    }
  }

  const failedModMatch = error.match(/from mod\s+([a-z0-9_.-]+)\s+failed injection check/i)
  const culpritMod = failedModMatch ? normalizeCulpritMod(failedModMatch[1]) : ''
  if (culpritMod && /(?:MixinTransformerError|InjectionError|Critical injection failure)/i.test(error)) {
    return {
      code: 'incompatible-mod-mixin',
      culpritMod
    }
  }

  return null
}

export const formatMinecraftCrashDiagnosisForReport = (diagnosis: MinecraftCrashDiagnosis | null) => {
  if (!diagnosis) return ''
  if (diagnosis.code === 'jvm-native-memory') {
    return 'NamLauncher diagnosis: Windows exhausted system commit/native memory even though the Minecraft heap may not have been full. Close unused applications. Enable a system-managed paging file, check free disk space, and restart if Windows requests it before retrying. Increasing Minecraft RAM can make this allocation failure more likely.'
  }
  if (diagnosis.code === 'graphics-memory') {
    return 'NamLauncher diagnosis: Minecraft could not allocate or map graphics memory while rendering. Check the active GPU and graphics drivers, then retry without shaders or high-memory visual settings.'
  }

  if (diagnosis.code === 'missing-mod-dependency') {
    const dependency = diagnosis.dependencyId || 'unknown dependency'
    const requirement = diagnosis.requiredVersion || 'a compatible version'
    const dependents = diagnosis.dependentMods?.length
      ? ` Required by: ${diagnosis.dependentMods.join(', ')}.`
      : ''
    return `NamLauncher diagnosis: Required dependency "${dependency}" is missing. Install ${requirement} for this Minecraft and loader version before retrying.${dependents}`
  }

  if (diagnosis.code === 'incompatible-mod-dependency') {
    const dependency = diagnosis.dependencyId || 'unknown dependency'
    const installed = diagnosis.installedVersion || 'unknown version'
    const requirement = diagnosis.requiredVersion || 'a compatible version'
    const dependents = diagnosis.dependentMods?.length
      ? ` Required by: ${diagnosis.dependentMods.join(', ')}.`
      : ''
    return `NamLauncher diagnosis: Dependency "${dependency}" ${installed} does not satisfy ${requirement}. Replace it with a compatible version before retrying.${dependents}`
  }

  const culprit = diagnosis.culpritMod || 'unknown mod'
  return `NamLauncher diagnosis: Mod "${culprit}" failed a critical Mixin injection during startup and is likely incompatible with this Minecraft or loader version. Disable or replace that mod before retrying.`
}
