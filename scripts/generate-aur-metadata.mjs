import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
const version = packageJson.version
const pkgver = version.replace(/-/g, '_')
const appImageName = `NamLauncher-${version}-Linux-x64.AppImage`
const appImageSha256 = String(process.argv[2] || '').toLowerCase()
const iconSha256 = String(process.argv[3] || '').toLowerCase()

if (!/^[a-f0-9]{64}$/.test(appImageSha256) || !/^[a-f0-9]{64}$/.test(iconSha256)) {
  throw new Error('Usage: node scripts/generate-aur-metadata.mjs <appimage-sha256> <icon-sha256>')
}

const outputDir = path.join(projectRoot, 'packaging', 'aur')
await mkdir(outputDir, { recursive: true })

const pkgbuild = `# Maintainer: Nattapat2871
# Author/creator: nattapat2871 (https://nattapat2871.me)
pkgname=namlauncher-bin
pkgver=${pkgver}
pkgrel=1
pkgdesc="Minecraft Java Edition launcher with isolated instances and managed content"
arch=('x86_64')
url="https://namlauncher.nattapat2871.me"
license=('custom')
depends=('fuse3' 'gtk3' 'nss' 'libxss' 'libnotify' 'xdg-utils')
optdepends=('discord: Discord Rich Presence support')
provides=('namlauncher')
conflicts=('namlauncher')
options=('!strip')
_upstream_ver=${version}
source=(
  "\${pkgname}-\${pkgver}.AppImage::https://namlauncher.nattapat2871.me/download/${appImageName}"
  "namlauncher.png::https://namlauncher.nattapat2871.me/assets/namlauncher-icon.png"
)
sha256sums=(
  '${appImageSha256}'
  '${iconSha256}'
)

package() {
  install -Dm755 "\${srcdir}/\${pkgname}-\${pkgver}.AppImage" "\${pkgdir}/opt/namlauncher/NamLauncher.AppImage"
  install -Dm644 "\${srcdir}/namlauncher.png" "\${pkgdir}/usr/share/icons/hicolor/512x512/apps/namlauncher.png"
  install -d "\${pkgdir}/usr/bin" "\${pkgdir}/usr/share/applications"
  ln -s /opt/namlauncher/NamLauncher.AppImage "\${pkgdir}/usr/bin/namlauncher"
  cat > "\${pkgdir}/usr/share/applications/namlauncher.desktop" <<'EOF'
[Desktop Entry]
Name=NamLauncher
Comment=Minecraft Java Edition launcher
Exec=namlauncher %U
Icon=namlauncher
Terminal=false
Type=Application
Categories=Game;
StartupWMClass=namlauncher
EOF
}
`

const srcinfo = `pkgbase = namlauncher-bin
\tpkgdesc = Minecraft Java Edition launcher with isolated instances and managed content
\tpkgver = ${pkgver}
\tpkgrel = 1
\turl = https://namlauncher.nattapat2871.me
\tarch = x86_64
\tlicense = custom
\tdepends = fuse3
\tdepends = gtk3
\tdepends = nss
\tdepends = libxss
\tdepends = libnotify
\tdepends = xdg-utils
\toptdepends = discord: Discord Rich Presence support
\tprovides = namlauncher
\tconflicts = namlauncher
\toptions = !strip
\tsource = namlauncher-bin-${pkgver}.AppImage::https://namlauncher.nattapat2871.me/download/${appImageName}
\tsource = namlauncher.png::https://namlauncher.nattapat2871.me/assets/namlauncher-icon.png
\tsha256sums = ${appImageSha256}
\tsha256sums = ${iconSha256}

pkgname = namlauncher-bin
`

await writeFile(path.join(outputDir, 'PKGBUILD'), pkgbuild, 'utf8')
await writeFile(path.join(outputDir, '.SRCINFO'), srcinfo, 'utf8')
console.log(`Generated AUR metadata for ${version}`)
