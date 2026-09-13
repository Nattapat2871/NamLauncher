// Author/creator: nattapat2871 (https://nattapat2871.me)

import { lstat, readFile, realpath, rm } from 'node:fs/promises'
import path from 'node:path'

const OPTIONAL_PACKAGE_NAME = 'register-scheme'
const projectRoot = path.resolve(import.meta.dirname, '..')
const nodeModulesRoot = path.join(projectRoot, 'node_modules')
const discordRpcPackagePath = path.join(nodeModulesRoot, 'discord-rpc', 'package.json')
const optionalPackagePath = path.join(nodeModulesRoot, OPTIONAL_PACKAGE_NAME)

const isMissing = (error) => error?.code === 'ENOENT'
const comparablePath = (value) => process.platform === 'win32' ? value.toLowerCase() : value

const assertExactOptionalPackageTarget = async () => {
  const packageInfo = await lstat(optionalPackagePath)
  if (!packageInfo.isDirectory() || packageInfo.isSymbolicLink()) {
    throw new Error(`Refusing to prune unsafe ${OPTIONAL_PACKAGE_NAME} package path.`)
  }

  const [physicalNodeModulesRoot, physicalPackagePath] = await Promise.all([
    realpath(nodeModulesRoot),
    realpath(optionalPackagePath)
  ])
  const relative = comparablePath(path.relative(physicalNodeModulesRoot, physicalPackagePath))
  if (relative !== comparablePath(OPTIONAL_PACKAGE_NAME)) {
    throw new Error(`Refusing to prune ${OPTIONAL_PACKAGE_NAME} outside the exact node_modules target.`)
  }
}

const discordRpcPackage = JSON.parse(await readFile(discordRpcPackagePath, 'utf8'))
if (typeof discordRpcPackage.optionalDependencies?.[OPTIONAL_PACKAGE_NAME] !== 'string') {
  throw new Error(`${OPTIONAL_PACKAGE_NAME} is no longer an optional discord-rpc dependency; refusing to prune it.`)
}

try {
  await assertExactOptionalPackageTarget()
  await rm(optionalPackagePath, { recursive: true })
  console.log(`Removed unused optional ${OPTIONAL_PACKAGE_NAME} native addon.`)
} catch (error) {
  if (!isMissing(error)) throw error
  console.log(`Unused optional ${OPTIONAL_PACKAGE_NAME} native addon is not installed.`)
}
