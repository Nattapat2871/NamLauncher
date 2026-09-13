// Author/creator: nattapat2871 (https://nattapat2871.me)

export type PartnerServerId = 'minisand' | 'namcraft' | 'teddyblock'

export type PartnerServerDefinition = Readonly<{
  id: PartnerServerId
  name: string
  address: string
  websiteUrl: `https://${string}/`
  iconUrl: string
  relationship: 'partner' | 'owned'
}>

export const PARTNER_SERVER_REVISION = 1

export const PARTNER_SERVERS: readonly PartnerServerDefinition[] = Object.freeze([
  Object.freeze({
    id: 'minisand',
    name: 'MiniSand',
    address: 'play.minisand.online',
    websiteUrl: 'https://minisand.online/',
    iconUrl: './minisand-logo.png',
    relationship: 'partner'
  }),
  Object.freeze({
    id: 'namcraft',
    name: 'NamCraft',
    address: 'namcraft.nattapat2871.me',
    websiteUrl: 'https://namcraft.nattapat2871.me/',
    iconUrl: 'https://namcraft.nattapat2871.me/icon.png',
    relationship: 'owned'
  }),
  Object.freeze({
    id: 'teddyblock',
    name: 'TeddyBlock',
    address: 'play.tdblock.online',
    websiteUrl: 'https://tdblock.online/',
    iconUrl: 'https://tdblock.online/server/logo-128.png',
    relationship: 'partner'
  })
])

export const getPartnerServer = (id: PartnerServerId) => (
  PARTNER_SERVERS.find((server) => server.id === id)
)
