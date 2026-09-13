// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  formatMinecraftCrashDiagnosisForReport,
  getMinecraftCrashDiagnosis
} from '../shared/minecraftCrashDiagnosis.ts'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appTextSource = await readFile(new URL('../src/appText.ts', import.meta.url), 'utf8')

test('identifies OpenGL buffer allocation failures even when an unrelated Realms warning appears first', () => {
  const diagnosis = getMinecraftCrashDiagnosis(`
    [Download-2/ERROR]: Couldn't connect to realms
    java.lang.IllegalStateException: Failed to map buffer
    at com.mojang.blaze3d.opengl.GlBuffer$Direct.map(GlBuffer.java:126)
    OpenGL debug message: GL error GL_OUT_OF_MEMORY
  `)

  assert.deepEqual(diagnosis, {
    code: 'graphics-memory'
  })
  assert.match(formatMinecraftCrashDiagnosisForReport(diagnosis), /graphics memory/i)
  assert.doesNotMatch(formatMinecraftCrashDiagnosisForReport(diagnosis), /Realms/i)
})

test('extracts the culprit mod from a critical Mixin injection failure', () => {
  const diagnosis = getMinecraftCrashDiagnosis(`
    Description: Initializing game
    Critical injection failure: Callback method preScreenshot(...)V in
    mixins.fabrishot.json:KeyboardMixin from mod fabrishot failed injection check,
    (0/1) succeeded. Scanned 0 target(s). No refMap loaded.
  `)

  assert.deepEqual(diagnosis, {
    code: 'incompatible-mod-mixin',
    culpritMod: 'fabrishot'
  })
  assert.match(formatMinecraftCrashDiagnosisForReport(diagnosis), /fabrishot/)
})

test('identifies an installed Fabric dependency that is too old for a mod', () => {
  const diagnosis = getMinecraftCrashDiagnosis(`
    A potential solution has been determined:
      - Replace mod 'Fabric API' (fabric-api) 0.134.1+1.21.9 with version 0.138.3+1.21.10 or later.
    More details:
      - Mod 'YetAnotherConfigLib' (yet_another_config_lib_v3) 3.8.2+1.21.10-fabric requires version 0.138.3+1.21.10 or later of mod 'Fabric API' (fabric-api), but only the wrong version is present.
  `)

  assert.deepEqual(diagnosis, {
    code: 'incompatible-mod-dependency',
    dependencyId: 'fabric-api',
    installedVersion: '0.134.1+1.21.9',
    requiredVersion: '0.138.3+1.21.10 or later',
    dependentMods: ['yet_another_config_lib_v3']
  })
  assert.match(formatMinecraftCrashDiagnosisForReport(diagnosis), /fabric-api/)
  assert.match(formatMinecraftCrashDiagnosisForReport(diagnosis), /0\.138\.3\+1\.21\.10/)
})

test('handles Fabric replacement suggestions that end with a compatibility clause', () => {
  const diagnosis = getMinecraftCrashDiagnosis(`
    Incompatible mods found!
    A potential solution has been determined:
      - Replace mod 'YetAnotherConfigLib' (yet_another_config_lib_v3) 3.8.2+1.21.10-fabric with version 3.8.0+1.21.9 or later that is compatible with:
        - fabric-api 0.134.1+1.21.9
    More details:
      - Mod 'Bridging Mod' (bridgingmod) 2.6.3+1.21.10 requires version 3.8.0+1.21.9 or later of mod 'YetAnotherConfigLib' (yet_another_config_lib_v3), but only the wrong version is present.
  `)

  assert.deepEqual(diagnosis, {
    code: 'incompatible-mod-dependency',
    dependencyId: 'yet_another_config_lib_v3',
    installedVersion: '3.8.2+1.21.10-fabric',
    requiredVersion: '3.8.0+1.21.9 or later',
    dependentMods: ['bridgingmod']
  })
  assert.match(formatMinecraftCrashDiagnosisForReport(diagnosis), /yet_another_config_lib_v3/)
  assert.doesNotMatch(formatMinecraftCrashDiagnosisForReport(diagnosis), /that is compatible with/i)
})

test('identifies a missing Fabric dependency and the mods that require it', () => {
  const diagnosis = getMinecraftCrashDiagnosis(`
    A potential solution has been determined:
      - Install fabric-api, version 0.152.1+26.2 or later.
    More details:
      - Mod 'Accurate Block Placement' (accurateblockplacement) requires any version of fabric-api, which is missing!
      - Mod 'Bridging Mod' (bridgingmod) requires any version of fabric-api, which is missing!
  `)

  assert.deepEqual(diagnosis, {
    code: 'missing-mod-dependency',
    dependencyId: 'fabric-api',
    requiredVersion: '0.152.1+26.2 or later',
    dependentMods: ['accurateblockplacement', 'bridgingmod']
  })
  assert.match(formatMinecraftCrashDiagnosisForReport(diagnosis), /missing/i)
  assert.match(formatMinecraftCrashDiagnosisForReport(diagnosis), /bridgingmod/)
})

test('does not invent a diagnosis for unrelated generic failures', () => {
  assert.equal(getMinecraftCrashDiagnosis('Minecraft exited with code 1'), null)
  assert.equal(getMinecraftCrashDiagnosis("Couldn't connect to realms"), null)
})

test('recognizes both reported Forge page-file failures and native allocation variants', () => {
  for (const message of [
    "Forge installer exited with code 1: os::commit_memory(0x730a00000, 952107008, 0) failed; error='The paging file is too small for this operation to complete' (DOS error/errno=1455)",
    'Native memory allocation (mmap) failed to map 1113587712 bytes. Error detail: G1 virtual space',
    'There is insufficient memory for the Java Runtime Environment to continue.',
    'Forge installer exited with code 1. Java native memory allocation failed (RAM / paging file).'
  ]) {
    const diagnosis = getMinecraftCrashDiagnosis(message)
    assert.equal(diagnosis.code, 'jvm-native-memory')
    assert.match(formatMinecraftCrashDiagnosisForReport(diagnosis), /system-managed paging file/)
    assert.match(formatMinecraftCrashDiagnosisForReport(diagnosis), /heap may not have been full/)
    assert.doesNotMatch(formatMinecraftCrashDiagnosisForReport(diagnosis), /incompatible.*mod/i)
  }
  assert.equal(getMinecraftCrashDiagnosis('Unable to download file 1455.jar'), null)
  assert.equal(getMinecraftCrashDiagnosis('Forge installer exited with code 1'), null)
})

test('shows localized diagnoses while preserving technical logs for local issues and owned reports', () => {
  assert.match(mainSource, /const diagnosis = getMinecraftCrashDiagnosis\(error\)/)
  assert.match(mainSource, /formatMinecraftCrashDiagnosisForReport\(report\.diagnosis \|\| null\)/)
  assert.match(mainSource, /message: truncateRemoteText\(reportMessage, ERROR_REPORT_MESSAGE_MAX_LENGTH\)/)
  assert.match(appSource, /diagnosis\?\.code === 'graphics-memory'/)
  assert.match(appSource, /diagnosis\?\.code === 'jvm-native-memory'/)
  assert.match(appTextSource, /nativeMemory.body.*system-managed paging file/)
  assert.match(appTextSource, /nativeMemory.body.*Paging file แบบให้ระบบจัดการ/)
  assert.match(appTextSource, /nativeMemory.body.*heap ของ Minecraft อาจยังไม่เต็ม/)
  assert.match(appSource, /minecraftGameIssue\?\.diagnosis \|\| null/)
  assert.match(appSource, /launcherError\.diagnosis\.mixin\.body/)
  assert.match(appSource, /launcherError\.diagnosis\.dependencyMissing\.body/)
  assert.match(appSource, /launcherError\.diagnosis\.dependencyVersion\.body/)
  assert.match(appTextSource, /หน่วยความจำกราฟิกไม่เพียงพอ/)
  assert.match(appTextSource, /มอด \{mod\} ไม่รองรับเวอร์ชันนี้/)
  assert.match(appTextSource, /ขาด dependency/)
})
