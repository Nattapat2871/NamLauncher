#!/usr/bin/env bash
# Author/creator: nattapat2871 (https://nattapat2871.me)
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_png="$project_root/NamLauncher-icon.png"
output_dir="$project_root/packaging/mac/generated"
output_icns="$output_dir/namlauncher.icns"

for required_tool in sips iconutil; do
  if ! command -v "$required_tool" >/dev/null 2>&1; then
    printf 'Required macOS icon tool is missing: %s\n' "$required_tool" >&2
    exit 1
  fi
done

if [[ ! -s "$source_png" ]]; then
  printf 'NamLauncher icon source is missing: %s\n' "$source_png" >&2
  exit 1
fi

temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/namlauncher-icon.XXXXXX")"
trap 'rm -rf -- "$temporary_root"' EXIT
iconset_dir="$temporary_root/namlauncher.iconset"
mkdir -p "$iconset_dir" "$output_dir"

while read -r pixels file_name; do
  sips -z "$pixels" "$pixels" "$source_png" --out "$iconset_dir/$file_name" >/dev/null
done <<'ICON_SIZES'
16 icon_16x16.png
32 icon_16x16@2x.png
32 icon_32x32.png
64 icon_32x32@2x.png
128 icon_128x128.png
256 icon_128x128@2x.png
256 icon_256x256.png
512 icon_256x256@2x.png
512 icon_512x512.png
1024 icon_512x512@2x.png
ICON_SIZES

iconutil -c icns "$iconset_dir" -o "$output_icns"
if [[ ! -s "$output_icns" ]]; then
  printf 'macOS icon generation failed: %s\n' "$output_icns" >&2
  exit 1
fi

printf 'Prepared macOS icon: %s\n' "$output_icns"
