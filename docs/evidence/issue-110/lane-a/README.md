# Issue #110 R3 — Lane A staging foundation evidence

## Scope and provenance

- Canonical issue: <https://github.com/bytefolk/org-workbench/issues/110>
- Consumed revision: R3, `status: in-progress`; decision record: <https://github.com/bytefolk/org-workbench/issues/110#issuecomment-5492495629>
- Base: `main@764bfe0df895abb29a6cdc841845743dd7cf7e7f`
- Source-level seed inspected with `git show` only: `4f8b49bad95bbd3d0a7866c61fceb8ea87f37f93`
- Candidate branch: `codex/feat-110-lane-a-packaging-foundation`
- Implementation owner: P8-lane-a. Automated pre-review is independent of the implementation owner. Human review remains owned by `@Bindy-lbb`; no review was requested by this local candidate.
- Local evidence host: macOS 15.5 (`24F74`), arm64, Node `v26.7.0`, npm `11.19.0`.

This lane creates only an unpacked staging foundation with no product/distribution signature and a clean-staging lifecycle smoke. Electron's macOS executable retains its upstream linker ad-hoc state; that is not a product signature. The lane does not create an installable artifact, publish anything, sign/notarize code, implement update behavior, change Finder/login-shell environment handling, or exercise a Qoder/Host business turn.

## Tests-first baseline (public-safe red)

All commands were run from the isolated Lane A worktree. No credential values or external state were read.

| Phase | Exact command | Exit | Observed result |
| --- | --- | ---: | --- |
| Baseline capability probe | `node --test scripts/test/package-layout.test.mjs` | 1 | Test entry was absent (`scripts/test/package-layout.test.mjs` not found). |
| Baseline command probe | `npm run package:staging:macos` | 1 | npm reported that `package:staging:macos` was not a defined script. |
| Tests added before implementation | `node --test scripts/test/package-layout.test.mjs` | 1 | 3/3 staging config/layout/script assertions failed while the JS config, manifest, and root staging scripts were still absent. |

The first packaging attempt after implementation also failed safely because the native Electron distribution was absent after dependency installation. Lane A added the deterministic `prepare:electron:staging` step (`node node_modules/electron/install.js`) before builder invocation. A first smoke attempt then exposed macOS's lexical `/var` versus canonical `/private/var` path alias; the assertion was tightened to compare both sides through `fs.realpath`, without widening the accepted staging boundary. Neither failed attempt is counted as green evidence below.

One later post-hardening chain is also explicitly discarded: after binding the report write to a pre-opened descriptor, smoke exited with `SIGTRAP` and Electron reported `Bad file descriptor (9)`. Root cause was a real lifecycle regression: successful report write closed the descriptor, then the BrowserWindow `closed` callback closed the same integer after the OS had reused it for an unrelated Electron descriptor. The close helper now takes the integer and sets `request.reportFd = null` before closing. A focused adversarial test closes the reservation, forces reuse of the exact descriptor number for a sentinel file, invokes duplicate cleanup, and proves the sentinel remains writable/readable. Only the complete post-fix chain below is authoritative.

The first smoke after the final path/identity hardening is also discarded. It timed out after 45 seconds because the external harness had renamed its temp prefix while the packaged-side allowlist intentionally continued to accept only `owb-clean-staging-*`; the request therefore failed closed and no report was created. The harness now uses the same frozen prefix, while the copied application path itself still contains spaces. Focused tests and the native smoke were rerun after the fix. This is recorded as an integration regression, not as shell or machine noise.

A focused process-fixture attempt is also discarded as a test-harness regression. Its synthetic fast-exit leader kept a referenced child handle, so the leader never exited and the test remained live for more than 80 seconds. The owned test PGIDs were identified from their Lane A cwd and terminated without touching another worktree or unrelated process. The fixture now calls `child.unref()`, has a 10-second test timeout, and registers `t.after` cleanup for its owned group/orphan. The narrow suite then passed three consecutive 19/19 runs; after the final reused-origin selection mutant was added, it passed three consecutive 20/20 runs. None of the hung attempt is used as green evidence.

## Requirement-to-implementation map

| Lane A requirement | Implementation | Evidence |
| --- | --- | --- |
| Exact unpacked-only builder tooling | Root devDependency pins `electron-builder` to `26.15.3`; macOS/Windows scripts use `--dir --publish never`; the canonical config has no installer/publish target, sets mac identity to null, and sets Windows `signExecutable: false` even under poisoned CSC variables. | `package-layout.test.mjs`; package command and builder output below. |
| Deterministic runtime layout | `apps/desktop/packaging/runtime-layout.cjs` names desktop main/preload modules, compiled control-plane modules, bundled Qoder entry, shared runtime modules, and every example fixture file. The clean renderer glob is accepted only as `index.html` plus bounded generated asset extensions. Electron-internal asar filenames are deliberately not product contracts. | Exact-inventory tests plus allowlisted resource-tree name and byte verification in `verify-packaged-app.mjs`. |
| Reject stale/unexpected/private content | Packaging removes staging and all relevant generated trees first. Cleanup and verification reject linked/junction parents, linked roots/files, FIFO/special nodes, missing/extra names, and any one-byte mismatch against every source/build input. Root `package.json` has one exact field-level builder transform. A denylist rejects `.env*`, maps, tests, keys/certificates, credentials/secrets, and package-time helpers. | Real temp-tree cases in `package-safety.test.mjs` inject missing/extra/forbidden/symlink/FIFO/tampered files; an external cleanup sentinel remains intact behind a rejected link. |
| Native staging signature/architecture verification | Verifier requires the native host, exactly one canonical candidate, exact version/main/runtime bytes, absent builder graph, native executable architecture, and no product/distribution signature. macOS narrowly accepts the observed unsealed upstream linker ad-hoc state (`adhoc,linker-signed`, no Authority/Team/seal); it rejects arbitrary `codesign` failure. | macOS report below proves arm64 and `unsealed-linker-adhoc`. Windows x64 PE/AuthentiCode code exists but is **NOT VERIFIED** until the native job runs. |
| Clean-staging lifecycle smoke | The artifact is copied to a canonical OS-temp root disjoint from the source tree, with spaces in the copied app path. A random 256-bit nonce binds request, trusted file query, and report. The packaged-only renderer mounts a static marker and calls no status/workspace/event/business bridge; main independently proves control-plane readiness. After normal close, the oracle checks bound app/control-plane/observed descendants and the isolated POSIX group, then removes temp state. | macOS report below; dynamic renderer test proves zero bridge calls. Parent dummy Host/CSC variables are not forwarded. This observes known/bound processes, not arbitrary malicious breakaway. |
| Preserve desktop security and dev behavior | The seam requires `app.isPackaged`, a canonical direct-child reservation under a fresh temp root, and a valid nonce. The descriptor-bound report rechecks identities and invalidates its fd before close. Load/spawn errors settle promptly; report-after-renderer-crash remains fatal until intentional close; cleanup always attempts both process termination and temp removal while preserving both errors. Existing `contextIsolation`, sandbox, node integration, enumerated preload IPC, and default `dev:desktop` entry remain unchanged. Smoke controls are stripped before the control-plane spawn. | Traversal, parent-swap, partial/malformed report, descriptor reuse, nonce, post-report lifecycle, spawn rejection, env-forgery, cleanup aggregation, and default-renderer tests; full desktop-main suite. |
| Native non-release CI evidence | Existing required `check` matrix is unchanged. Separate `macos-15` arm64 and `windows-latest` x64 jobs install, stage, verify, and smoke natively under top-level `contents: read`. | Static workflow inspection only; no CI run is claimed here. |

## Independent blue-team P1 disposition

| Finding | Disposition |
| --- | --- |
| Seed mixed macOS-only/Lane B assumptions | Closed: no `macos-login-path` change, no server/health/environment filtering change, and no PATHEXT resolution change was imported. |
| Packaged production seam could run during development, escape its report root, suffer a parent swap, or accept a forged child report | Closed: `app.isPackaged`, canonical direct-child path, lstat/realpath rejection, exclusive descriptor-bound write, 256-bit request/query/report nonce, and stripping all smoke controls from the control-plane child. Real parent-swap and child-env fixtures fail closed. |
| Reserved empty/partial report, spawn rejection, duplicate close, or post-report renderer crash could false-pass/hang/corrupt another fd | Closed: bounded parsing retry with final-malformed failure; closed promise settles resolve/reject; main explicitly catches smoke/load rejection; fd close is take-and-null idempotent; renderer/load/window loss is fatal until the harness begins intentional close. Focused tests cover each state, including exact fd reuse. |
| Stale output, parent links, special nodes, fail-open globs, or same-name byte tampering could be blessed | Closed: canonical ancestor/root confinement, clean-before-build, explicit inventories, bounded renderer outputs, denylist, all-node traversal, exact name set, and byte comparison for every allowlisted regular file. Real temp fixtures cover linked candidate/resources/clean parents, missing/extra/forbidden/FIFO and one-byte tamper. |
| Binary architecture and “unsigned” claim were too broad | Closed on current macOS evidence: `lipo` must be exactly `arm64`; `codesign` execution must succeed and return only the precise unsealed linker ad-hoc semantics with no Authority, Team, or resource seal. Report calls this `unsealed-linker-adhoc`; checksum is not signing. Windows reads x64 PE and requires `NotSigned`, but is **NOT VERIFIED**. |
| Windows internal asar name and default executable signing were nondeterministic | Closed in config/tests: verifier contracts only Workbench exe/resources, never Electron's `electron.asar`/`default_app.asar`; `win.signExecutable` is false and a poisoned CSC config test cannot change it. Native Windows execution remains **NOT VERIFIED**. |
| Raw PID cleanup could kill a reused unrelated process, leak a child during launch-to-bind, or miss a TERM-spawned child | Closed for the claimed known boundary: launch records spawn provenance before binding start/executable identity; signal functions revalidate bound identities and reject raw PIDs. If the leader exits before binding, POSIX selection uses only the expected detached PGID, never raw origin-PID ancestry or command text; a synthetic reused-origin tree is excluded while the true group orphan is selected. Live fixtures prove that orphan and a TERM-spawned same-group child are bound/reaped while unrelated sentinels survive. Windows null-root recovery uses only already-bound identities or the canonical staging path and repeated stable-empty scans. Malicious breakaway/reparent to an unrelated system binary is not guaranteed or claimed. |
| Cleanup error could skip temp removal | Closed: process and directory cleanup are independent attempts; one or both errors are retained, with an `AggregateError` when both fail. |
| Lane A smoke accidentally depended on health/Qoder/business behavior | Closed: the trusted packaged query mounts only a static renderer marker. Dynamic tests prove status/workspace/event/turn bridge calls stay at zero while the ordinary entry still renders `App`; control-plane readiness comes from main's ready line. The native snapshot observed zero Qoder descendants, but does not claim a universal process-execution audit. |
| `TMPDIR` inside the repository could defeat clean staging | Closed: temp base, staging root, and copied app are canonical and mutually disjoint from the canonical source tree before launch. An in-source temp fixture is rejected without creating staging; an external path containing spaces succeeds. |

## Authoritative macOS arm64 serial evidence

The accepted run used one fail-fast foreground shell and verified its repository root before starting. No background operator (`&`) or parallel tool call was used. It ran on macOS 15.5 / Darwin 24.5.0 arm64 with Node v26.7.0 and npm 11.19.0. The fixed dummy values for Qoder, Anthropic, and CSC variables were deliberately not printed or retained; only their variable names are shown below. The commands ran strictly in this order, and each step completed before the next began:

```bash
git rev-parse --show-toplevel
git rev-parse HEAD
git merge-base HEAD origin/main
node -v && npm -v && uname -a && arch
shasum -a 256 package-lock.json
npm ci
shasum -a 256 package-lock.json
node --test scripts/test/package-layout.test.mjs \
  scripts/test/package-safety.test.mjs \
  scripts/test/smoke-packaged-app.test.mjs
node --test apps/desktop/test/control-plane-launch.test.cjs \
  apps/desktop/test/packaged-smoke.test.cjs
npm run test:renderer -- renderer/test/packaged-smoke-entry.test.tsx
npm run check
env QODER_PERSONAL_ACCESS_TOKEN=… ANTHROPIC_API_KEY=… \
  CSC_LINK=… WIN_CSC_LINK=… npm run package:staging:macos
npm run verify:package:macos
env QODER_PERSONAL_ACCESS_TOKEN=… ANTHROPIC_API_KEY=… \
  CSC_LINK=… WIN_CSC_LINK=… npm run smoke:package:macos
# bounded known-process and Node-cwd scan
git diff --check
# targeted secret scan excluding lockfiles and generated output
shasum -a 256 package-lock.json
git status --short --branch
```

| Step marker | Exit | Observed result |
| --- | ---: | --- |
| `environment` | 0 | `PWD` and top level were the isolated Lane A worktree; HEAD and merge-base were both `764bfe0df895abb29a6cdc841845743dd7cf7e7f`; host/version facts match the paragraph above. |
| `cold npm ci` | 0 | Added 592 packages, audited 599, found 0 vulnerabilities. Lock SHA-256 before/after remained `1c40dff8b49dd17bf38c4344d09be40a82c4aedd5ab3fd71d5d544565c024a60`. |
| `focused script behavior tests` | 0 | 15/15 passed, including real temp-tree verifier/cleaner, signature-classifier, report polling, temp confinement, cleanup aggregation, and fast-exit leader behavior. |
| `focused desktop main behavior tests` | 0 | 17/17 passed, including smoke-control stripping, descriptor/nonce/lifecycle, PID/identity mutants, reused-origin selection, and live process cleanup. |
| `focused packaged renderer entry test` | 0 | 2/2 passed: static smoke entry made zero representative bridge calls; ordinary entry still rendered `App`. |
| `full repository check` | 0 | scripts 19/19; UI 31/31; server 148 passed + 1 expected skip; renderer 157/157; desktop main 54/54; audit 0 vulnerabilities. |
| `native macOS arm64 unpacked staging with poison parent env` | 0 | electron-builder 26.15.3 produced `release/staging/mac-arm64/Org Workbench.app` from Electron 43.4.1 for darwin arm64; product signing was skipped because identity is null. Only unpacked `dir` staging was requested and poisoned CSC variables were not consumed. |
| `verify native macOS staging` | 0 | Exact allowlisted inventory/bytes, version/main, no-product-signature state, and native arm64 executable verified. |
| `clean-copy native macOS smoke with poison parent env` | 0 | Static renderer entry and control-plane readiness observed; dummy external credentials were not forwarded; known/bound residual count was 0 and temp staging was removed. The one snapshot observed zero Qoder descendants; it is not a universal never-executed claim. |
| Final residual/cwd, diff, secret, and lock checks | 0 | Known residual processes 0; Node cwd residuals 0; `git diff --check` clean; targeted secret-like matches 0; final lock SHA-256 unchanged. |
| `complete` | 0 | `AUTHORITY_CHAIN_EXIT=0`; the entire post-fix foreground chain completed. |

Sanitized verifier output:

```json
{"schemaVersion":"org-workbench-staging-manifest.v1","ok":true,"platform":"macos","artifact":"release/staging/mac-arm64/Org Workbench.app","version":"0.0.0","architecture":"arm64","unsigned":true,"signature":"unsealed-linker-adhoc","requiredEntries":30,"packagedFiles":185,"mainSha256":"60ccd15ced0ee0b0c473daeda1df53ee5bd4577383bbd54ca3a076aae388b86c","rendererSha256":"133a77f216a8b0cca86b846902e1891b6492de02883ae2f13be717a365ab6dcd","serverSha256":"deeb8a71871d341107bc04db3a12c853c20463b70f37fc78e93dc37d2f1c6bb7"}
```

Sanitized smoke output:

```json
{"schemaVersion":"org-workbench-clean-staging-smoke.v1","ok":true,"platform":"macos","architecture":"arm64","artifact":"release/staging/mac-arm64/Org Workbench.app","stagedOutsideSourceTree":true,"stagedPathHasSpaces":true,"rendererEntryObserved":true,"staticSmokeEntry":true,"controlPlaneReady":true,"trackedWorkbenchPid":true,"trackedControlPlanePid":true,"externalCredentialsForwarded":false,"liveDescendants":4,"qoderDescendantsObserved":0,"knownResidualProcesses":0,"stagingCleaned":true}
```

No PID, boot token, environment secret, response body, or machine-specific absolute path is retained in this ledger.

## Dependency and workflow audit

- `electron-builder@26.15.3` is an exact, root-level development dependency (MIT metadata), never a shipped runtime dependency. Lock SRI: `sha512-a1KM5heqS3gQCZzizXEI8RjJy3QVogULPdeSknt76uLDpBIW/HDGsMg/XgP0riP6PI9COsRvFITKKGDqA8fJxA==`.
- Final cold reproduction: `npm ci` exited 0, added 592 packages, audited 599 packages with 0 vulnerabilities, and left `package-lock.json` byte-identical; SHA-256 before/after was `1c40dff8b49dd17bf38c4344d09be40a82c4aedd5ab3fd71d5d544565c024a60`.
- Relative to the base lock, the intended lock delta is exactly 265 builder-reachable entries, all `dev: true`, registry-resolved and integrity-bearing, with no removals or pre-existing resolved/integrity churn. The root metadata is the only changed existing package entry. A local sibling `design-system` metadata rewrite produced by the first lock-only install was rejected and restored to the base lock before validation.
- Lock metadata has no GPL/AGPL/SSPL/unknown blocker. `npm audit --audit-level=high` reports high 0, critical 0, total 0.
- The only lifecycle script in the builder graph is `electron-winstaller@5.4.0`; its install script selects/copies bundled local host-architecture 7-Zip files and does not perform a network fetch. Its npm metadata says MIT, but bundled WiX/7-Zip/Windows SDK/Squirrel notice/provenance is **NOT VERIFIED** (the WiX config names MS-RL and the tarball lacks the referenced `LICENSE.TXT`). Lane A passes only because the entire graph is dev-only and the verifier proves it is absent from the artifact. Do not ship this graph, select Squirrel, or redistribute its vendor payload without a separate third-party-license review; Lane C's planned NSIS route is a separate review.
- Builder may fetch checksum-pinned Electron/7-Zip/NSIS/rcedit/winCodeSign toolsets in future lanes. Do not add custom mirror/override environment variables without separate HTTPS and checksum review. Checksum integrity is not code signing.
- Every package command includes `--publish never`; there is no updater, signing identity, release credential, custom mirror, or publish configuration.
- Workflow top-level authority remains `permissions: contents: read`; trigger remains `pull_request`/main push, not `pull_request_target`; no `${{ secrets.* }}` expression exists. Windows was not added to the existing required `check` matrix.
- The new arm64 staging job uses `macos-15`, which the official runner-image table maps to macOS 15 arm64. `macos-14` began deprecation on 2026-07-06 and retires on 2026-11-02, so it is not used for new staging evidence. The existing required `check` matrix still names `macos-14`; changing that required-check context is intentionally left to a separately coordinated policy update. Sources: <https://github.com/actions/runner-images#available-images>, <https://github.com/actions/runner-images/issues/13518>.
- Existing mutable `actions/checkout@v6` and `actions/setup-node@v6` tags remain a supply-chain residual. Lane A reuses those existing action identities/versions; full-SHA pinning is recommended in a separately reviewed workflow change.

## Cleanup, rollback, and limits

Packaging output is confined to ignored `release/staging/`. Smoke temp roots use a canonical OS temp directory disjoint from the repository. Process termination and recursive temp removal are separately attempted even when either fails; the accepted report records `stagingCleaned: true`. No tag, release, upload, issue/PR mutation, signing request, installer execution, real credential access, or other external state was created.

Rollback is a normal revert of the eventual Lane A candidate/PR commit, followed by deletion of ignored `release/staging/` if locally retained. Because the lane has no migration, publish, update feed, or durable external state, no data rollback is required. Source development remains available through the unchanged `npm run dev:desktop` path.

The following are explicitly **NOT VERIFIED / out of Lane A scope**:

- Windows x64 package/verify/smoke results until `staging-windows-x64` actually runs on `windows-latest`; the local macOS host did not run or emulate them.
- CI job completion for either platform; this candidate only statically defines the jobs.
- DMG, ZIP, NSIS, MSI, Program Files installation, uninstall, install-over-old-version, explicit release architecture policy, Intel Mac, signing, notarization, Authenticode signing, GitHub Release assets, tags, publishing permissions, or auto-update. Those belong to Lane C or later release lanes.
- Finder/login-shell PATH import, environment propagation policy, Qoder/health filtering, or PATHEXT resolution. Those belong to Lane B.
- External credentials, Host entitlement, Qoder business turns, memory/onboarding/first-run behavior, or release rollback drills.
- A universal containment guarantee for arbitrary or malicious process breakaway. The macOS E3 proves the actual Workbench, reported control plane, observed bound descendants, and inherited detached POSIX group reached zero; an explicit adversarial fixture proves a TERM-spawned same-group child is reaped and a PID-reuse sentinel is not signaled. A child that deliberately creates a new session with `setsid` is outside the claimed boundary. Windows uses creation/executable-bound known-process scans, but reparent/breakaway to an unrelated system binary is **NOT GUARANTEED / NOT VERIFIED** without a native Job Object; Lane A adds no native helper or dependency.
- Subprocess timeout/output caps for every `ps`/PowerShell/codesign/lipo helper and generated renderer total-size ceilings remain defense-in-depth follow-ups. Current processes are bounded by the outer workflow timeout and exact/extension-constrained inventory, but those are not equivalent controls.

Evidence grade for the accepted local path is E3 on current macOS arm64 only. No cross-platform or installable-release claim is inferred from it.
