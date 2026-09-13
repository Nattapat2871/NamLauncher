// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  hasMeaningfulLauncherData,
  hasLauncherInstances,
  listCommonWindowsLauncherDataCandidates,
  selectUniqueLegacyLauncherDataPath
} from '../shared/dataLocationRecovery.ts'

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'namlauncher-data-recovery-'))

const createManagedInstance = (dataPath, instanceName = 'survival') => {
  const instancePath = path.join(dataPath, 'instances', instanceName)
  fs.mkdirSync(path.join(instancePath, 'game'), { recursive: true })
  fs.writeFileSync(
    path.join(instancePath, 'namlauncher-instance.json'),
    JSON.stringify({ instanceId: `instance-${instanceName}` }),
    'utf8'
  )
}

test('recognizes real launcher instances or saved accounts as meaningful data', () => {
  const root = makeTempRoot()
  try {
    const emptyData = path.join(root, 'empty')
    fs.mkdirSync(emptyData)
    fs.writeFileSync(path.join(emptyData, 'settings.json'), '{}', 'utf8')
    assert.equal(hasMeaningfulLauncherData(emptyData), false)

    const instanceData = path.join(root, 'instance-data')
    createManagedInstance(instanceData)
    assert.equal(hasMeaningfulLauncherData(instanceData), true)
    assert.equal(hasLauncherInstances(instanceData), true)

    const accountData = path.join(root, 'account-data')
    fs.mkdirSync(accountData)
    fs.writeFileSync(path.join(accountData, 'accounts.json'), '[{"id":"player"}]', 'utf8')
    assert.equal(hasMeaningfulLauncherData(accountData), true)
    assert.equal(hasLauncherInstances(accountData), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('lists only bounded common data locations on valid Windows drive roots', () => {
  const candidates = listCommonWindowsLauncherDataCandidates(['D:\\', 'not-a-drive', 'D:\\'])
  assert.ok(candidates.includes(path.win32.resolve('D:\\Minecraft\\NamLauncher\\NamLauncher-data')))
  assert.ok(candidates.includes(path.win32.resolve('D:\\NamLauncher-data')))
  assert.equal(candidates.some((candidate) => candidate.includes('not-a-drive')), false)
})

test('recovers one verified legacy location when the default data has no player state', () => {
  const root = makeTempRoot()
  try {
    const defaultDataPath = path.join(root, 'default')
    const legacyDataPath = path.join(root, 'legacy')
    fs.mkdirSync(defaultDataPath)
    fs.writeFileSync(path.join(defaultDataPath, 'settings.json'), '{}', 'utf8')
    createManagedInstance(legacyDataPath)

    assert.equal(selectUniqueLegacyLauncherDataPath({
      defaultDataPath,
      candidatePaths: [legacyDataPath]
    }), path.resolve(legacyDataPath))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('recovers old game instances even if the accidental default location saved an account', () => {
  const root = makeTempRoot()
  try {
    const defaultDataPath = path.join(root, 'default')
    const legacyDataPath = path.join(root, 'legacy')
    fs.mkdirSync(defaultDataPath)
    fs.writeFileSync(path.join(defaultDataPath, 'accounts.json'), '[{"id":"new-login"}]', 'utf8')
    createManagedInstance(legacyDataPath)

    assert.equal(selectUniqueLegacyLauncherDataPath({
      defaultDataPath,
      candidatePaths: [legacyDataPath]
    }), path.resolve(legacyDataPath))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('does not replace an established default location or guess between multiple valid locations', () => {
  const root = makeTempRoot()
  try {
    const defaultDataPath = path.join(root, 'default')
    const firstCandidate = path.join(root, 'first')
    const secondCandidate = path.join(root, 'second')
    createManagedInstance(defaultDataPath, 'default')
    createManagedInstance(firstCandidate, 'first')
    assert.equal(selectUniqueLegacyLauncherDataPath({
      defaultDataPath,
      candidatePaths: [firstCandidate]
    }), '')

    fs.rmSync(defaultDataPath, { recursive: true, force: true })
    fs.mkdirSync(defaultDataPath)
    createManagedInstance(secondCandidate, 'second')
    assert.equal(selectUniqueLegacyLauncherDataPath({
      defaultDataPath,
      candidatePaths: [firstCandidate, secondCandidate]
    }), '')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
