// Author/creator: nattapat2871 (https://nattapat2871.me)

type SelectableInstance = {
  id: string
}

export type InstanceDetailNavigation = Readonly<{
  instanceId: string
  activeView: 'instances'
  panelView: 'content'
  contentTab: 'mods'
}>

export type InstanceModsLibraryNavigation = Readonly<{
  instanceId: string
  activeView: 'library'
  libraryType: 'mod'
}>

const normalizeNavigationInstanceId = (instanceId: string) => instanceId.trim()

export const getInstanceDetailNavigation = (instanceId: string): InstanceDetailNavigation | null => {
  const normalizedInstanceId = normalizeNavigationInstanceId(instanceId)
  if (!normalizedInstanceId) return null

  return {
    instanceId: normalizedInstanceId,
    activeView: 'instances',
    panelView: 'content',
    contentTab: 'mods'
  }
}

export const getInstanceModsLibraryNavigation = (instanceId: string): InstanceModsLibraryNavigation | null => {
  const normalizedInstanceId = normalizeNavigationInstanceId(instanceId)
  if (!normalizedInstanceId) return null

  return {
    instanceId: normalizedInstanceId,
    activeView: 'library',
    libraryType: 'mod'
  }
}

export const resolveSelectedInstanceId = (
  instances: SelectableInstance[],
  selectedInstanceId: string | null
) => {
  if (selectedInstanceId && instances.some((instance) => instance.id === selectedInstanceId)) {
    return selectedInstanceId
  }

  return instances.length === 1 ? instances[0].id : null
}
