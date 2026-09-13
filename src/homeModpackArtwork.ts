// Author/creator: nattapat2871 (https://nattapat2871.me)

type ModrinthGalleryEntry = string | { url?: unknown }

export type HomeModpackArtworkSource = {
  featured_gallery?: unknown
  gallery?: unknown
  icon_url?: unknown
}

export type HomeModpackArtwork = {
  bannerUrl: string | null
  iconUrl: string | null
}

const TRUSTED_MODRINTH_IMAGE_HOSTS = new Set([
  'cdn.modrinth.com',
  'cdn-raw.modrinth.com'
])

const getTrustedModrinthImageUrl = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return null

  try {
    const parsed = new URL(value.trim())
    if (
      parsed.protocol !== 'https:'
      || !TRUSTED_MODRINTH_IMAGE_HOSTS.has(parsed.hostname.toLowerCase())
      || Boolean(parsed.username || parsed.password)
      || Boolean(parsed.port && parsed.port !== '443')
    ) {
      return null
    }
    return parsed.href
  } catch {
    return null
  }
}

const getGalleryEntryUrl = (entry: ModrinthGalleryEntry) => {
  if (typeof entry === 'string') return getTrustedModrinthImageUrl(entry)
  return getTrustedModrinthImageUrl(entry?.url)
}

export const resolveHomeModpackArtwork = (project: HomeModpackArtworkSource): HomeModpackArtwork => {
  const featuredUrl = getTrustedModrinthImageUrl(project.featured_gallery)
  const galleryUrl = Array.isArray(project.gallery)
    ? (project.gallery as ModrinthGalleryEntry[]).map(getGalleryEntryUrl).find(Boolean) || null
    : null

  return {
    bannerUrl: featuredUrl || galleryUrl,
    iconUrl: getTrustedModrinthImageUrl(project.icon_url)
  }
}
