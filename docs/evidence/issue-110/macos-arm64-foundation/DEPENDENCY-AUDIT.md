# Issue #110 macOS arm64 foundation dependency audit

This is evidence for a partial foundation lane only. It does not claim Issue
#110 is complete and does not cover Windows/x64, signing, notarization,
publication, or updates.

## Decision

The local unsigned macOS packaging lane adds exactly one direct dependency:
`electron-builder@26.15.3`. It is an exact, development-only dependency used
to assemble the `.app`; the runtime FileSets do not copy electron-builder or
the source checkout's `node_modules` tree into `Contents/Resources/app`.

| Field | Evidence |
| --- | --- |
| package | `electron-builder@26.15.3` |
| license | MIT |
| lock integrity | `sha512-a1KM5heqS3gQCZzizXEI8RjJy3QVogULPdeSknt76uLDpBIW/HDGsMg/XgP0riP6PI9COsRvFITKKGDqA8fJxA==` |
| scope | root `devDependencies` only |
| published/runtime import | none |
| update policy | exact version; lockfile required |

The version is the exact reviewed release selected for this implementation.
Its package metadata and lock integrity agree. The packaged runtime is defined
by `apps/desktop/packaging/runtime-layout.cjs`; the verifier rejects missing
required entries, unexpected mirrored-tree entries, symlinks, and a mismatched
Qoder resolver source hash.

The existing workspace pins `electron@43.4.1`. A clean npm install lays down
its wrapper without a binary distribution, so the packaging command explicitly
runs Electron's checksum-verifying installer before builder and points builder
at that exact local distribution. This avoids a second implicit builder fetch
without assuming that stale `node_modules` state already contains `dist/`.

## Transitive notice

The locked build graph currently reports deprecated build-only transitives
`boolean@3.2.0` (MIT), `rimraf@2.6.3` (ISC), `inflight@1.0.6` (ISC), and
`glob@7.2.3` (ISC). They arrive through the current electron-builder graph,
are not imported by Workbench product code, and are not copied by the narrow
runtime manifest. This is accepted for the unsigned local build lane and must
be reassessed on the next electron-builder update.

## Security and release boundary

- `npm audit` is the repository gate and must report zero vulnerabilities.
- The builder config has no publish configuration, uses a macOS `dir` target,
  and sets `identity: null`.
- CI verifies and smokes the app in place but does not upload artifacts.
- This partial lane performs no `/Applications` install, signing, notarization,
  tag, GitHub Release, or external publication.
- `asar: false` is intentional for transparent runtime-file verification and
  Node child-process execution. It is not treated as a tamper-resistance or
  trust boundary.
