// Author/creator: nattapat2871 (https://nattapat2871.me)

const SAFE_IDENTIFIER = /^[A-Za-z0-9._+-]+$/

export const getForgeArtifactCoordinates = (minecraftVersion: string, forgeVersion: string) => {
  const minecraft = String(minecraftVersion || '').trim()
  const forge = String(forgeVersion || '').trim()
  if (!SAFE_IDENTIFIER.test(minecraft) || !SAFE_IDENTIFIER.test(forge)) {
    throw new Error('Forge artifact versions contain unsupported characters.')
  }

  const standard = `${minecraft}-${forge}`
  // Forge 1.7.10 build 1614 and a few other legacy publications repeat the
  // Minecraft version at the end of their Maven coordinate. Trying this
  // official coordinate after the standard one is safe and backwards-compatible.
  return [standard, `${standard}-${minecraft}`]
}
