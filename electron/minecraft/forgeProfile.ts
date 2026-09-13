// Author/creator: nattapat2871 (https://nattapat2871.me)
const DIRECT_MAIN_CLASSES = new Set([
  'cpw.mods.bootstraplauncher.BootstrapLauncher',
  'net.minecraftforge.bootstrap.ForgeBootstrap'
])

/** New Forge bootstraps must run from the official installed profile, not ForgeWrapper 1.6.0. */
export const shouldInstallForgeProfileDirectly = (profile: unknown, minecraftVersion: string): boolean => {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('The Forge installer has an invalid version profile.')
  const value = profile as Record<string, unknown>
  if (value.inheritsFrom !== minecraftVersion || typeof value.id !== 'string'
    || !/^[A-Za-z0-9._+-]{1,160}$/.test(value.id) || !Array.isArray(value.libraries)
    || typeof value.mainClass !== 'string') {
    throw new Error('The Forge installer profile does not match the selected Minecraft version.')
  }
  return DIRECT_MAIN_CLASSES.has(value.mainClass)
}
