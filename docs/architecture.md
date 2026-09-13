# NamLauncher Repository Architecture

NamLauncher is split by trust boundary and release responsibility.

| Repository | Visibility | Responsibility |
| --- | --- | --- |
| `NamLauncher/NamLauncher` | Public | Electron launcher, UI, packaging, tests, and verified prebuilt companion artifacts |
| `NamLauncher/platform` | Private | Website, API, Discord integration, authentication, release metadata, and data schemas |
| `NamLauncher/minecraft-companions` | Private | Fabric, Forge, and NeoForge source, compatibility tests, and bundle exporter |
| `NamLauncher/operations` | Private | Deployment templates, validation, operational runbooks, and rollback procedures |

## Dependency direction

The launcher may call documented Platform HTTP APIs and verify a companion
bundle. Platform and Operations must not be imported into the desktop build.
Companion source and build toolchains must not be copied into the public
repository. Operations contains no application source or production secret.

The public launcher bundle is accepted only when its manifest version matches
the launcher version and every declared file passes size, SHA-256, identity,
and resource checks.

## Secret boundary

Credentials, private signing keys, OAuth secrets, database files, reports,
runtime logs, `.env` files, and `.qa` workspaces are never committed. GitHub
Actions receives required values only through repository or environment
secrets.

Author/creator: [nattapat2871](https://nattapat2871.me)
