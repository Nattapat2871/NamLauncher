# Development Workflow

`main` contains the latest stable source and currently remains at `1.2.3`.
`develop` contains the local-only `1.2.4-beta3` integration build.

1. Create focused branches from `develop`.
2. Install dependencies with `npm ci`.
3. Run `npm run prepare:game-bridge`, `npm run build`, and `npm test`.
4. Open a pull request into `develop` and wait for CI.
5. Promote an audited stable commit to `main` only through a dedicated release
   pull request. Stable users must never be directed through a beta download.

Release publication, production deployment, Discord announcements, and updates
to website download metadata are separate guarded operations. A source push by
itself does not authorize any of them.

Author/creator: [nattapat2871](https://nattapat2871.me)
