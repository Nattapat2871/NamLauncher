import axios from 'axios'

export const getFabricVersions = async (mcVersion: string) => {
  const response = await axios.get(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`)
  return response.data
    .map((item: any) => ({
      id: item.loader?.version || item.version,
      type: item.loader?.stable || item.stable ? 'stable' : 'unstable'
    }))
    .filter((item: any) => item.id)
}

export const getForgeVersions = async (mcVersion: string) => {
  const response = await axios.get('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')
  const promos = response.data.promos || {}
  const versions = [
    promos[`${mcVersion}-recommended`] ? { id: promos[`${mcVersion}-recommended`], type: 'recommended' } : null,
    promos[`${mcVersion}-latest`] ? { id: promos[`${mcVersion}-latest`], type: 'latest' } : null
  ].filter(Boolean) as Array<{ id: string; type: string }>

  return versions.filter((item, index) => versions.findIndex((candidate) => candidate.id === item.id) === index)
}
