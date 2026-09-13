// Author/creator: nattapat2871 (https://nattapat2871.me)

export type HomeDiscoveryLane = 'popular' | 'updated' | 'newest'

export type HomeDiscoveryProject = {
  id?: unknown
  project_id?: unknown
  slug?: unknown
  [key: string]: unknown
}

export type HomeDiscoveryLaneResult = {
  lane: HomeDiscoveryLane
  hits: HomeDiscoveryProject[]
}

const hashSeed = (seed: string) => {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const createSeededRandom = (seed: string) => {
  let state = hashSeed(seed) || 0x9e3779b9
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

const shuffleStable = <T>(items: T[], seed: string) => {
  const shuffled = [...items]
  const random = createSeededRandom(seed)
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]]
  }
  return shuffled
}

const getProjectKey = (project: HomeDiscoveryProject) => {
  return String(project.project_id || project.id || project.slug || '').trim().toLowerCase()
}

/**
 * Builds a session-stable discovery row with fair lane representation.
 * Each lane is shuffled independently, then remaining slots are filled from
 * all healthy lanes without repeating a project.
 */
export const selectHomeDiscoveryProjects = (
  laneResults: HomeDiscoveryLaneResult[],
  sessionSeed: string,
  total = 6,
  perLane = 2
) => {
  const selected: HomeDiscoveryProject[] = []
  const seen = new Set<string>()
  const shuffledLanes = laneResults.map((result) => ({
    lane: result.lane,
    hits: shuffleStable(Array.isArray(result.hits) ? result.hits : [], `${sessionSeed}:${result.lane}`)
  }))

  const add = (project: HomeDiscoveryProject, lane: HomeDiscoveryLane) => {
    const key = getProjectKey(project)
    if (!key || seen.has(key) || selected.length >= total) return false
    seen.add(key)
    selected.push({ ...project, discovery_lane: lane })
    return true
  }

  for (const result of shuffledLanes) {
    let laneCount = 0
    for (const project of result.hits) {
      if (add(project, result.lane)) laneCount += 1
      if (laneCount >= perLane || selected.length >= total) break
    }
  }

  if (selected.length < total) {
    const overflow = shuffleStable(
      shuffledLanes.flatMap((result) => result.hits.map((project) => ({ project, lane: result.lane }))),
      `${sessionSeed}:overflow`
    )
    for (const item of overflow) {
      add(item.project, item.lane)
      if (selected.length >= total) break
    }
  }

  return selected
}
