import axios from 'axios'

export const getLatestVersion = async () => {
  const response = await axios.get('https://launchermeta.mojang.com/mc/game/version_manifest.json')
  return response.data.latest.release
}

export const getAllVersions = async () => {
  const response = await axios.get('https://launchermeta.mojang.com/mc/game/version_manifest.json')
  return response.data.versions.filter((v: any) => v.type === 'release')
}
