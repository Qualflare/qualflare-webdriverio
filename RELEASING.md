# Releasing

## Cutting a release

1. Make sure `main` is green. `.github/workflows/ci.yml` must pass: unit and
   built-format tests, the real-WebdriverIO integration suite on 8 and 9, the
   packaged-tarball job and the no-network check.
2. Bump `version` in `package.json`.
3. Update `CHANGELOG.md`.
4. Commit: `chore: release vX.Y.Z`.
5. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`. Pushing the tag triggers
   `.github/workflows/npm-publish.yml`, which:
   - checks the tag against `package.json`
   - re-runs typecheck, lint, the unit, built and integration tests, and the
     dogfood suite
   - publishes with a provenance attestation
   - waits until the version resolves on the registry with provenance attached
6. Only then release `@qualflare/appium` against the new version, if it needs
   the change.

Publishing needs the `NPM_TOKEN` repository secret. A local `npm publish` fails
by design: `publishConfig.provenance` requires the CI's OIDC token.

## Before 1.0.0

- [ ] A live upload has been checked in the Qualflare UI, not just the report
      file. The E2E workflow uploads every push to `main`; confirm that the
      launch shows all of the dogfood workers' cases, the screenshots and the
      flaky attempt.
- [ ] qualflare-cli recognizes `webdriverio` and `appium` as frameworks. Until
      then, launches carry the category `generic`: degraded, never rejected.
- [ ] A real Appium session has run through `@qualflare/appium`, on a simulator
      or device, with `platform: ios`/`android` and the device properties
      confirmed in the UI.
- [ ] `docs/` reviewed against `src/config/resolve-config.ts` and
      `src/runtime/qualflare-api.ts`. The code is the source of truth.
