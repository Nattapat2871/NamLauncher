// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import { resolveHomeModpackArtwork } from '../src/homeModpackArtwork.ts'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('prefers the official featured Modrinth gallery image over the icon', () => {
  assert.deepEqual(resolveHomeModpackArtwork({
    featured_gallery: 'https://cdn.modrinth.com/data/example/images/featured_350.webp',
    gallery: ['https://cdn.modrinth.com/data/example/images/gallery_350.webp'],
    icon_url: 'https://cdn.modrinth.com/data/example/icon_96.webp'
  }), {
    bannerUrl: 'https://cdn.modrinth.com/data/example/images/featured_350.webp',
    iconUrl: 'https://cdn.modrinth.com/data/example/icon_96.webp'
  })
})

test('uses the first valid gallery image and keeps the square icon only as fallback', () => {
  assert.deepEqual(resolveHomeModpackArtwork({
    gallery: [
      'http://cdn.modrinth.com/data/example/insecure.png',
      { url: 'https://cdn-raw.modrinth.com/data/example/images/gallery.png' }
    ],
    icon_url: 'https://cdn.modrinth.com/data/example/icon.png'
  }), {
    bannerUrl: 'https://cdn-raw.modrinth.com/data/example/images/gallery.png',
    iconUrl: 'https://cdn.modrinth.com/data/example/icon.png'
  })
})

test('rejects untrusted artwork URLs instead of loading arbitrary remote images', () => {
  assert.deepEqual(resolveHomeModpackArtwork({
    featured_gallery: 'https://example.com/banner.png',
    gallery: ['javascript:alert(1)'],
    icon_url: 'https://example.com/icon.png'
  }), {
    bannerUrl: null,
    iconUrl: null
  })
})

test('Home cards use a banner ratio, cover gallery art, and contain icon fallbacks', () => {
  const homeCards = appSource.match(/\{homeModpacks\.map\(\(modpack\) => \{[\s\S]*?\n\s*\}\)\}/)?.[0] || ''
  assert.match(homeCards, /resolveHomeModpackArtwork\(modpack\)/)
  assert.match(homeCards, /aspect-\[2\/1\]/)
  assert.match(homeCards, /src=\{artwork\.bannerUrl\}[\s\S]*object-cover/)
  assert.match(homeCards, /src=\{artwork\.iconUrl\}[\s\S]*object-contain/)
  assert.match(homeCards, /loading="lazy"/)
  assert.doesNotMatch(homeCards, /green-/)
  assert.match(appSource, /animate-pulse overflow-hidden[\s\S]*aspect-\[2\/1\]/)
})
