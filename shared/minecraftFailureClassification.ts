// Author/creator: nattapat2871 (https://nattapat2871.me)
import {
  getMinecraftCrashDiagnosis,
  type MinecraftCrashDiagnosis
} from './minecraftCrashDiagnosis.ts'

export type MinecraftFailureCategory =
  | 'namlauncher-component'
  | 'user-content'
  | 'game-environment'
  | 'unknown-game'

export type MinecraftFailureCode =
  | 'namlauncher-component-failure'
  | 'namlauncher-runtime-failure'
  | 'mod-dependency'
  | 'mod-mixin'
  | 'mod-loading'
  | 'resource-pack-invalid'
  | 'graphics-environment'
  | 'jvm-memory'
  | 'native-environment'
  | 'client-shutdown-hang'
  | 'unknown-game-exit'

export type MinecraftFailureOwner =
  | 'namlauncher'
  | 'player-content'
  | 'game-environment'
  | 'unknown'

export type MinecraftFailureReportPolicy = 'automatic' | 'local-only'

export type MinecraftFailureClassification = Readonly<{
  category: MinecraftFailureCategory
  code: MinecraftFailureCode
  owner: MinecraftFailureOwner
  confidence: 'high' | 'medium' | 'low'
  reportPolicy: MinecraftFailureReportPolicy
  phase: 'game-process'
}>

export type MinecraftGameIssue = Readonly<{
  id: string
  instanceId: string
  instanceName: string
  exitCode: number | null
  occurredAt: string
  logPath?: string | null
  /** Bounded diagnostic text for the local-only issue dialog; never a report payload. */
  logs?: string
  classification: MinecraftFailureClassification
  diagnosis?: MinecraftCrashDiagnosis | null
}>

const NAMLAUNCHER_COMPONENT_ID = /(?:namlauncher[-_]game[-_]companion|namlauncher[-_]branding[-_]bridge)/i
const NAMLAUNCHER_COMPONENT_CLASS = /com\.namlauncher\.bridge(?:\.|\b)/i
const FATAL_COMPONENT_SIGNAL = /(?:caused by:|exception|error|critical injection failure|failed injection check|mixin apply failed|mixintransformererror|invalidmixinexception)/i
const INCOMPATIBLE_COMPONENT_SIGNAL = /(?:requires|depends on).{0,240}(?:missing|wrong version|but .{0,120}(?:present|installed)|currently .{0,120}(?:present|installed))/i
const CALENDAR_MINECRAFT_26_OR_NEWER_SIGNAL = /(?:Loading Minecraft|Minecraft(?: version)?)[\s:=]+(?:2[6-9]|[3-9]\d)\.\d+/i
const JAVA_25_MISMATCH_SIGNAL = /(?:Replace ['"]?OpenJDK[\s\S]{0,160}?java\)?\s*2[1-4][\s\S]{0,160}?version 25|requires version 25(?: or later)? of ['"]?(?:OpenJDK[^'"\r\n]*|java)['"]?[\s\S]{0,240}?(?:wrong version|only .{0,80}(?:present|installed)))/i

const isNamLauncherComponentId = (value: unknown) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-')
  return normalized === 'namlauncher-game-companion' || normalized === 'namlauncher-branding-bridge'
}

const diagnosisReferencesNamLauncher = (diagnosis: MinecraftCrashDiagnosis | null) => {
  return isNamLauncherComponentId(diagnosis?.culpritMod)
    || isNamLauncherComponentId(diagnosis?.dependencyId)
    || Boolean(diagnosis?.dependentMods?.some(isNamLauncherComponentId))
}

const hasOwnedComponentFailureEvidence = (error: string, diagnosis: MinecraftCrashDiagnosis | null) => {
  if (diagnosisReferencesNamLauncher(diagnosis)) return true

  const lines = error.split(/\r?\n/)
  if (lines.some((line) => (
    (NAMLAUNCHER_COMPONENT_ID.test(line) || NAMLAUNCHER_COMPONENT_CLASS.test(line))
    && (FATAL_COMPONENT_SIGNAL.test(line) || INCOMPATIBLE_COMPONENT_SIGNAL.test(line))
  ))) return true

  // A bundled mod in the installed-mod list is not evidence that it caused a
  // nearby exception. Only a direct NamLauncher stack origin counts here.
  return /(?:caused by:|[\w.$]+(?:Exception|Error))[^\r\n]*\r?\n\s*at\s+com\.namlauncher\.bridge\./i.test(error)
}

export const isLocalMinecraftLaunchFailure = (
  failure: MinecraftFailureClassification,
  gameIssueAlreadyShown = false,
  gameProcessStarted = false
) => failure.reportPolicy === 'local-only' && (
  gameIssueAlreadyShown
  || gameProcessStarted
  || failure.category === 'user-content'
  || failure.category === 'game-environment'
)

const getUserContentFailureCode = (
  error: string,
  diagnosis: MinecraftCrashDiagnosis | null
): MinecraftFailureCode | null => {
  if (diagnosis?.code === 'missing-mod-dependency' || diagnosis?.code === 'incompatible-mod-dependency') {
    return 'mod-dependency'
  }
  if (diagnosis?.code === 'incompatible-mod-mixin') return 'mod-mixin'

  if (
    /(?:[\\/]resourcepacks[\\/]|Failed to open pack|pack\.mcmeta|Resource Pack Options|resource pack)/i.test(error)
    && /(?:ZipException|zip file is empty|zip END header not found|invalid LOC header|Failed to open pack|Couldn't (?:parse|get) pack|Variable [^\r\n]+ not found|pack metadata)/i.test(error)
  ) return 'resource-pack-invalid'

  if (/MixinTransformerError|MixinApplyError|InvalidMixinException|InjectionError|Critical injection failure|failed injection check/i.test(error)) {
    return 'mod-mixin'
  }

  if (
    /Incompatible mods found|Mod resolution failed|Mod Loading has failed|Mod loading error has occurred|HARD_DEP(?:_NO_CANDIDATE)?|ModLoadingException|LoadingFailedException|EntrypointException|Could not execute entrypoint .{0,160}provided by|Missing or unsupported mandatory dependencies|needs language provider|requires .{0,160}(?:which is missing|but only the wrong version|currently .{0,80} is present)|Invalid mod file|Failed to load mod|Failed to create mod instance.{0,120}ModID:|has failed to load correctly|has failed during the .{0,80} event phase|Caught exception from .{1,80}|Duplicate (?:network )?channel|channel .{0,120} already registered|QuiltLoaderException/i.test(error)
  ) return 'mod-loading'

  if (
    /(?:ZipException|zip END header not found|invalid LOC header|error in opening zip file)[\s\S]{0,600}(?:[\\/]mods[\\/]|\.jar\b)|(?:[\\/]mods[\\/]|\.jar\b)[\s\S]{0,600}(?:ZipException|zip END header not found|invalid LOC header|error in opening zip file)/i.test(error)
  ) return 'mod-loading'

  return null
}

const getEnvironmentFailureCode = (
  error: string,
  diagnosis: MinecraftCrashDiagnosis | null
): MinecraftFailureCode | null => {
  if (/Client shutdown from window close callback|Watchdog \(Client shutdown from window close callback\)|glfwDestroyWindow/i.test(error)) {
    return 'client-shutdown-hang'
  }

  if (
    diagnosis?.code === 'graphics-memory'
    || /GL_OUT_OF_MEMORY|Failed to map buffer|GLFW error 65542|OpenGL.*(?:not supported|driver)|Pixel format not accelerated/i.test(error)
  ) return 'graphics-environment'

  if (diagnosis?.code === 'jvm-native-memory'
    || /OutOfMemoryError|Java heap space|GC overhead limit exceeded|Could not reserve enough space for object heap/i.test(error)) {
    return 'jvm-memory'
  }

  if (/EXCEPTION_ACCESS_VIOLATION|SIGSEGV|A fatal error has been detected by the Java Runtime Environment|Problematic frame:/i.test(error)) {
    return 'native-environment'
  }

  return null
}

export const classifyMinecraftProcessFailure = (
  rawError: unknown,
  suppliedDiagnosis?: MinecraftCrashDiagnosis | null,
  options: Readonly<{
    managedComponentActive?: boolean
    managedJavaRuntimeActive?: boolean
  }> = {}
): MinecraftFailureClassification => {
  const error = String(rawError || '')
  const diagnosis = suppliedDiagnosis === undefined
    ? getMinecraftCrashDiagnosis(error)
    : suppliedDiagnosis

  if (
    options.managedJavaRuntimeActive !== false
    && CALENDAR_MINECRAFT_26_OR_NEWER_SIGNAL.test(error)
    && JAVA_25_MISMATCH_SIGNAL.test(error)
  ) {
    return {
      category: 'namlauncher-component',
      code: 'namlauncher-runtime-failure',
      owner: 'namlauncher',
      confidence: 'high',
      reportPolicy: 'automatic',
      phase: 'game-process'
    }
  }

  if (options.managedComponentActive !== false && hasOwnedComponentFailureEvidence(error, diagnosis)) {
    return {
      category: 'namlauncher-component',
      code: 'namlauncher-component-failure',
      owner: 'namlauncher',
      confidence: 'high',
      reportPolicy: 'automatic',
      phase: 'game-process'
    }
  }

  const contentCode = getUserContentFailureCode(error, diagnosis)
  if (contentCode) {
    return {
      category: 'user-content',
      code: contentCode,
      owner: 'player-content',
      confidence: diagnosis || /Incompatible mods found|ModLoadingException|LoadingFailedException/i.test(error)
        ? 'high'
        : 'medium',
      reportPolicy: 'local-only',
      phase: 'game-process'
    }
  }

  const environmentCode = getEnvironmentFailureCode(error, diagnosis)
  if (environmentCode) {
    return {
      category: 'game-environment',
      code: environmentCode,
      owner: 'game-environment',
      confidence: diagnosis ? 'high' : 'medium',
      reportPolicy: 'local-only',
      phase: 'game-process'
    }
  }

  return {
    category: 'unknown-game',
    code: 'unknown-game-exit',
    owner: 'unknown',
    confidence: 'low',
    reportPolicy: 'local-only',
    phase: 'game-process'
  }
}
