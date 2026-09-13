// Author/creator: nattapat2871 (https://nattapat2871.me)

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,'
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_MINECRAFT_ICON_DATA_URL_CHARACTERS = 384 * 1024
const MAX_MINECRAFT_ICON_BYTES = 288 * 1024
const MAX_MINECRAFT_ICON_DIMENSION = 512

/** Rejects malformed or oversized PNG canvases before Chromium attempts to decode them. */
export const sanitizeMinecraftPngDataUrl = (value: unknown): string | null => {
  if (
    typeof value !== 'string'
    || value.length > MAX_MINECRAFT_ICON_DATA_URL_CHARACTERS
    || !value.startsWith(PNG_DATA_URL_PREFIX)
  ) return null

  const encoded = value.slice(PNG_DATA_URL_PREFIX.length)
  if (!encoded || encoded.length % 4 !== 0 || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) return null

  let content: Buffer
  try {
    content = Buffer.from(encoded, 'base64')
  } catch {
    return null
  }
  if (
    content.length < 33
    || content.length > MAX_MINECRAFT_ICON_BYTES
    || !content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    || content.readUInt32BE(8) !== 13
    || content.toString('ascii', 12, 16) !== 'IHDR'
  ) return null

  const width = content.readUInt32BE(16)
  const height = content.readUInt32BE(20)
  if (
    width < 1
    || height < 1
    || width > MAX_MINECRAFT_ICON_DIMENSION
    || height > MAX_MINECRAFT_ICON_DIMENSION
    || width * height > MAX_MINECRAFT_ICON_DIMENSION ** 2
  ) return null

  return value
}
