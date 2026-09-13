#!/bin/sh
# Author/creator: nattapat2871 (https://nattapat2871.me)
set -eu

INSTALL_ROOT='/opt/NamLauncher'
EXECUTABLE_PATH="$INSTALL_ROOT/namlauncher"
SANDBOX_PATH="$INSTALL_ROOT/chrome-sandbox"
LAUNCHER_LINK='/usr/bin/namlauncher'
APPARMOR_PROFILE_SOURCE="$INSTALL_ROOT/resources/apparmor-profile"
APPARMOR_PROFILE_TARGET='/etc/apparmor.d/namlauncher'

fail_install() {
  printf 'NamLauncher post-install error: %s\n' "$1" >&2
  exit 1
}

if [ "$(id -u)" -ne 0 ]; then
  fail_install 'root privileges are required to secure the Chromium sandbox.'
fi

if [ ! -d "$INSTALL_ROOT" ] || [ -L "$INSTALL_ROOT" ]; then
  fail_install "unexpected installation root: $INSTALL_ROOT"
fi
install_root_owner=$(stat -c '%u:%g' -- "$INSTALL_ROOT")
install_root_mode=$(stat -c '%a' -- "$INSTALL_ROOT")
if [ "$install_root_owner" != '0:0' ]; then
  fail_install 'installation root must be owned by root.'
fi
case "$install_root_mode" in
  *[2367][0-7]|*[0-7][2367]) fail_install 'installation root must not be group- or world-writable.' ;;
esac

for required_file in "$EXECUTABLE_PATH" "$SANDBOX_PATH"; do
  if [ ! -f "$required_file" ] || [ -L "$required_file" ]; then
    fail_install "required regular file is missing or unsafe: $required_file"
  fi
done

# Native packages use Chromium's root-owned SUID sandbox. This avoids a false
# positive from probing user namespaces as root when ordinary users are denied.
chown root:root -- "$SANDBOX_PATH"
chmod 4755 -- "$SANDBOX_PATH"

if [ "$(stat -c '%u:%g:%a' -- "$SANDBOX_PATH")" != '0:0:4755' ]; then
  fail_install 'chrome-sandbox ownership or mode verification failed.'
fi

if command -v update-alternatives >/dev/null 2>&1; then
  if [ -e "$LAUNCHER_LINK" ] || [ -L "$LAUNCHER_LINK" ]; then
    if [ ! -L "$LAUNCHER_LINK" ]; then
      fail_install "refusing to replace non-symlink path: $LAUNCHER_LINK"
    fi
    current_target=$(readlink "$LAUNCHER_LINK")
    if [ "$current_target" != '/etc/alternatives/namlauncher' ] && [ "$current_target" != "$EXECUTABLE_PATH" ]; then
      fail_install "refusing to replace unexpected symlink target: $current_target"
    fi
  fi
  update-alternatives --install "$LAUNCHER_LINK" namlauncher "$EXECUTABLE_PATH" 100
else
  if [ -e "$LAUNCHER_LINK" ] || [ -L "$LAUNCHER_LINK" ]; then
    if [ ! -L "$LAUNCHER_LINK" ] || [ "$(readlink "$LAUNCHER_LINK")" != "$EXECUTABLE_PATH" ]; then
      fail_install "refusing to replace unexpected launcher path: $LAUNCHER_LINK"
    fi
  else
    ln -s "$EXECUTABLE_PATH" "$LAUNCHER_LINK"
  fi
fi

if command -v update-mime-database >/dev/null 2>&1; then
  update-mime-database /usr/share/mime || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi

if command -v apparmor_status >/dev/null 2>&1 && apparmor_status --enabled >/dev/null 2>&1; then
  if [ -f "$APPARMOR_PROFILE_SOURCE" ] && [ ! -L "$APPARMOR_PROFILE_SOURCE" ] && command -v apparmor_parser >/dev/null 2>&1; then
    if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" >/dev/null 2>&1; then
      if [ -e "$APPARMOR_PROFILE_TARGET" ] || [ -L "$APPARMOR_PROFILE_TARGET" ]; then
        if [ ! -f "$APPARMOR_PROFILE_TARGET" ] || [ -L "$APPARMOR_PROFILE_TARGET" ]; then
          fail_install "refusing to replace unsafe AppArmor profile: $APPARMOR_PROFILE_TARGET"
        fi
      fi
      install -o root -g root -m 0644 "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"
      if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; }; then
        apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
      fi
    else
      printf '%s\n' 'NamLauncher: bundled AppArmor profile is unsupported on this host; the SUID sandbox remains enabled.' >&2
    fi
  fi
fi
