// Author/creator: nattapat2871 (https://nattapat2871.me)
export const getFallbackJavaMajorVersion = (mcVersion: string): number => {
  const calendarVersion = mcVersion.match(/^(\d{2})(?:\.(\d+))?/)
  if (calendarVersion) {
    const release = Number(calendarVersion[1])
    if (release >= 26) return 25
  }

  const match = mcVersion.match(/^1\.(\d+)(?:\.(\d+))?/)
  if (!match) return 21

  const minor = Number(match[1])
  const patch = Number(match[2] || 0)

  if (minor <= 16) return 8
  if (minor === 17) return 16
  if (minor === 18 || minor === 19) return 17
  if (minor === 20 && patch <= 4) return 17
  return 21
}
