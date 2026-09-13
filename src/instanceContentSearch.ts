export type SearchableInstanceContent = {
  name: string
  fileName: string
  enabledFileName?: string
  versionNumber?: string | null
}

export const filterInstanceContent = <T extends SearchableInstanceContent>(
  items: T[],
  query: string
) => {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return items

  return items.filter((item) => [
    item.name,
    item.fileName,
    item.enabledFileName,
    item.versionNumber
  ].some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery)))
}
