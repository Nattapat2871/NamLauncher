// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import {
  applyCustomJavaArgumentPolicy,
  getPerformanceJavaArgs,
  getRecommendedMemoryGb,
  getSafeMaximumMemoryGb,
  normalizePerformanceProfile,
  resolvePerformancePolicy
} from '../electron/performancePolicy.ts'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('normalizes unknown performance profiles to automatic', () => {
  assert.equal(normalizePerformanceProfile('max-fps'), 'max-fps')
  assert.equal(normalizePerformanceProfile('turbo-magic'), 'automatic')
})

test('keeps enough memory available for the operating system on low-spec computers', () => {
  assert.equal(getSafeMaximumMemoryGb(4), 2)
  assert.equal(getRecommendedMemoryGb(4, 'automatic'), 2)
  assert.equal(getSafeMaximumMemoryGb(8), 5)
  assert.equal(getRecommendedMemoryGb(8, 'low-spec', 'fabric'), 4)
})

test('caps automatic and manual allocations before they force the system to swap', () => {
  const automatic = resolvePerformancePolicy({
    totalMemoryGb: 8,
    requestedMemoryGb: 32,
    automaticMemory: true,
    profile: 'automatic',
    minecraftVersion: '1.21.1',
    loader: 'fabric'
  })
  assert.equal(automatic.memoryGb, 5)
  assert.equal(automatic.memoryMax, '3840M')
  assert.equal(automatic.memoryMin, '512M')
  assert.equal(automatic.nativeMemoryReserveMb, 1024)
  assert.equal(automatic.launcherMemoryReserveMb, 256)
  assert.equal(automatic.heapMaxMb + automatic.nativeMemoryReserveMb + automatic.launcherMemoryReserveMb, 5 * 1024)

  const manual = resolvePerformancePolicy({
    totalMemoryGb: 8,
    requestedMemoryGb: 32,
    automaticMemory: false,
    profile: 'balanced'
  })
  assert.equal(manual.memoryGb, 5)
})

test('treats the selected RAM amount as a total play-session budget instead of a heap-only limit', () => {
  const policy = resolvePerformancePolicy({
    totalMemoryGb: 16,
    requestedMemoryGb: 6,
    automaticMemory: false,
    profile: 'max-fps',
    minecraftVersion: '26.2',
    loader: 'fabric'
  })
  assert.equal(policy.memoryGb, 6)
  assert.equal(policy.memoryMax, '4864M')
  assert.equal(policy.memoryMin, '512M')
  assert.equal(policy.heapMaxMb, 4864)
  assert.equal(policy.nativeMemoryReserveMb, 1024)
  assert.equal(policy.launcherMemoryReserveMb, 256)
  assert.equal(policy.heapMaxMb + policy.nativeMemoryReserveMb + policy.launcherMemoryReserveMb, 6 * 1024)

  const minimumPolicy = resolvePerformancePolicy({
    totalMemoryGb: 4,
    requestedMemoryGb: 1,
    automaticMemory: false,
    profile: 'low-spec',
    minecraftVersion: '1.20.1',
    loader: 'forge'
  })
  assert.equal(minimumPolicy.heapMaxMb, 768)
  assert.equal(minimumPolicy.heapMaxMb + minimumPolicy.nativeMemoryReserveMb + minimumPolicy.launcherMemoryReserveMb, 1024)
})

test('uses only conservative supported GC options and leaves automatic mode ergonomic', () => {
  assert.deepEqual(getPerformanceJavaArgs('automatic', '1.21.1'), [])
  assert.deepEqual(getPerformanceJavaArgs('low-spec', '1.12.2'), ['-XX:+UseG1GC'])
  assert.deepEqual(getPerformanceJavaArgs('low-spec', '1.21.1'), [
    '-XX:+UseG1GC',
    '-XX:+UseStringDeduplication'
  ])
  assert.deepEqual(getPerformanceJavaArgs('max-fps', '1.21.1'), [
    '-XX:+UseG1GC',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+ParallelRefProcEnabled'
  ])
})

test('removes server flag packs that force risky client memory behavior on every platform', () => {
  const requested = [
    '-XX:+UseG1GC',
    '-XX:+AlwaysPreTouch',
    '-XX:+UseNUMA',
    '-XX:AlwaysPreTouch=true',
    '-XX:UseNUMA=1',
    '-Xmx12G',
    '-Xms8G',
    '-XX:MaxRAMPercentage=95',
    '-XX:G1HeapRegionSize=32m',
    '-XX:G1NewSizePercent=20',
    '-XX:G1ReservePercent=20',
    '-XX:G1MixedGCCountTarget=8',
    '-XX:InitiatingHeapOccupancyPercent=15',
    '-XX:+DisableExplicitGC',
    '-XX:MaxGCPauseMillis=50',
    '-Dexample.safe=true'
  ]
  assert.deepEqual(applyCustomJavaArgumentPolicy(requested, 'win32'), {
    javaArgs: ['-XX:+UseG1GC', '-Dexample.safe=true'],
    removedArguments: [
      '-XX:+AlwaysPreTouch',
      '-XX:+UseNUMA',
      '-XX:AlwaysPreTouch=true',
      '-XX:UseNUMA=1',
      '-Xmx12G',
      '-Xms8G',
      '-XX:MaxRAMPercentage=95',
      '-XX:G1HeapRegionSize=32m',
      '-XX:G1NewSizePercent=20',
      '-XX:G1ReservePercent=20',
      '-XX:G1MixedGCCountTarget=8',
      '-XX:InitiatingHeapOccupancyPercent=15',
      '-XX:+DisableExplicitGC',
      '-XX:MaxGCPauseMillis=50'
    ]
  })
  assert.deepEqual(applyCustomJavaArgumentPolicy(requested, 'linux'), {
    javaArgs: ['-XX:+UseG1GC', '-Dexample.safe=true'],
    removedArguments: [
      '-XX:+AlwaysPreTouch',
      '-XX:+UseNUMA',
      '-XX:AlwaysPreTouch=true',
      '-XX:UseNUMA=1',
      '-Xmx12G',
      '-Xms8G',
      '-XX:MaxRAMPercentage=95',
      '-XX:G1HeapRegionSize=32m',
      '-XX:G1NewSizePercent=20',
      '-XX:G1ReservePercent=20',
      '-XX:G1MixedGCCountTarget=8',
      '-XX:InitiatingHeapOccupancyPercent=15',
      '-XX:+DisableExplicitGC',
      '-XX:MaxGCPauseMillis=50'
    ]
  })
})

test('keeps every profile elastic instead of reserving the selected amount at startup', () => {
  for (const profile of ['automatic', 'low-spec', 'balanced', 'max-fps']) {
    const policy = resolvePerformancePolicy({
      totalMemoryGb: 16,
      requestedMemoryGb: 6,
      automaticMemory: false,
      profile,
      minecraftVersion: '26.2',
      loader: 'fabric'
    })
    assert.equal(policy.memoryMin, '512M')
    assert.ok(policy.heapMaxMb > 512)
  }
})

test('throttles the hidden launcher and avoids mixing automatic JVM flags with custom flags', () => {
  assert.match(mainSource, /backgroundThrottling: true/)
  assert.match(mainSource, /automaticMemory: settings\.automaticMemory === true/)
  assert.match(mainSource, /automaticMemory: typeof settings\.automaticMemory === 'boolean'[\s\S]*\? settings\.automaticMemory[\s\S]*: current\.automaticMemory/)
  assert.match(mainSource, /const performanceJavaArgs = settings\.customJavaArgsEnabled[\s\S]*\? \[\][\s\S]*: performancePolicy\.javaArgs/)
  assert.match(mainSource, /applyCustomJavaArgumentPolicy\(requestedCustomArgs, process\.platform\)/)
  assert.match(mainSource, /applyCustomJavaArgumentPolicy\(requestedLoaderArgs, process\.platform\)/)
  assert.match(mainSource, /\.\.\.performanceJavaArgs/)
  assert.match(appSource, /role="group"[\s\S]*aria-label=\{t\('settings\.performance\.profile\.title'\)\}/)
  assert.match(appSource, /aria-pressed=\{discordSettings\.performanceProfile === profile\}/)
  assert.match(appSource, /if \(!bootReady \|\| windowHidden\) return/)
  assert.match(appSource, /setInterval\(loadStats, 5 \* 60_000\)/)
  assert.match(appSource, /if \(windowHidden\) return[\s\S]*const intervalMs = gameRunning \? 60_000 : 30_000/)
})
