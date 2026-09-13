# Contributing to NamLauncher

Contributions to the public launcher are welcome through a focused branch and
pull request.

1. Create a short-lived branch from `develop` for the next version. Use `main`
   only as the base for an approved stable hotfix.
2. Keep backend, Discord bot, production operations, databases, and credentials
   out of this repository.
3. Run `npm run build` and `npm test` before opening a pull request.
4. Explain the user-facing behavior, verification performed, and any remaining
   limitation.
5. Do not upload installers or beta binaries unless a maintainer explicitly
   requests a release artifact.

The `main` branch is the latest stable source. The `develop` branch is the
integration branch and can contain local-only beta versions.

By contributing, you agree that your contribution is licensed under
GPL-3.0-only. Third-party material must retain its original license and notice.

Author/creator: [nattapat2871](https://nattapat2871.me)
