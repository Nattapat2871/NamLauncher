import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('does not request loader metadata before a Minecraft version is selected', () => {
  assert.match(appSource, /requestedLoader === 'vanilla' \|\| !requestedVersion/)
})

test('falls back from version-specific Quilt metadata to generic and Maven indexes', () => {
  assert.match(mainSource, /QUILT_META_BASE = 'https:\/\/meta\.quiltmc\.org\/v3'/)
  assert.match(mainSource, /QUILT_MAVEN_METADATA_URL = 'https:\/\/maven\.quiltmc\.org\/repository\/release\/org\/quiltmc\/quilt-loader\/maven-metadata\.xml'/)
  assert.match(mainSource, /trying the generic loader index/)
  assert.match(mainSource, /trying Maven metadata/)
})

test('switches unsupported Quilt game versions to the latest supported stable release', () => {
  assert.match(mainSource, /getQuiltGameCompatibility/)
  assert.match(mainSource, /`\$\{QUILT_META_BASE\}\/versions\/game`/)
  assert.match(mainSource, /Quilt does not support Minecraft/)
  assert.match(appSource, /getLoaderCompatibility\(requestedLoader, requestedVersion\)/)
  assert.match(appSource, /switched to \$\{recommendedVersion\}/)
})

test('runs the NeoForge installer headlessly with the managed Java runtime', () => {
  assert.match(mainSource, /spawn\(javaPath, \[[\s\S]*'-Djava\.awt\.headless=true'[\s\S]*'--install-client'[\s\S]*instanceRoot/)
  assert.match(mainSource, /prepareLoader\(instanceRoot, instance, javaPath, launchSessionState\.abortController\.signal\)/)
})

test('opens java.lang.invoke for NeoForge on modern Java runtimes', () => {
  assert.match(mainSource, /const JAVA_MODULE_OPEN_ARGS = \[[\s\S]*'--add-opens=java\.base\/java\.lang\.invoke=ALL-UNNAMED'[\s\S]*\]/)
  assert.match(mainSource, /const shouldUseJavaModuleOpenArgs = \(mcVersion: string\) => \{/)
  assert.match(mainSource, /return Number\(match\[1\]\) >= 17/)
  assert.match(mainSource, /'--add-opens=java\.base\/java\.lang\.invoke=ALL-UNNAMED'/)
  assert.match(mainSource, /const baseJavaArgs = getLaunchJavaArgs\(settings, instance\.version\)/)
  assert.match(mainSource, /const javaArgs = \[[\s\S]*\.\.\.baseJavaArgs,[\s\S]*\.\.\.performanceJavaArgs,[\s\S]*\.\.\.loaderJavaArgs,[\s\S]*\.\.\.offlineSkinLaunch\.javaArgs[\s\S]*\]/)
})

test('requires the NeoForge installer to produce an installed version profile', () => {
  assert.match(mainSource, /if \(!fs\.existsSync\(installedProfilePath\)[\s\S]*runNeoForgeInstaller/)
  assert.match(mainSource, /NeoForge installer completed without creating/)
})

test('passes NeoForge profile module-path arguments through to the launch command', () => {
  assert.match(mainSource, /arguments\?: \{[\s\S]*jvm\?: VersionProfileArgument\[\]/)
  assert.match(mainSource, /javaArgs: resolveNeoForgeJvmArguments\(instanceRoot, customVersionId, profile\.arguments\?\.jvm \|\| \[\]\)/)
  assert.match(mainSource, /\$\{library_directory\}/)
  assert.match(mainSource, /\$\{classpath_separator\}/)
  assert.match(mainSource, /const requestedLoaderArgs = Array\.isArray\(\(loader as any\)\.javaArgs\)/)
  assert.match(mainSource, /const loaderJavaArgs = loaderArgumentPolicy\.javaArgs/)
})
