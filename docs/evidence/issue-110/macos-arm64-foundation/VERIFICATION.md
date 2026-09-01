# Issue #110 macOS arm64 foundation verification

This is a partial foundation result only. It does not complete Issue #110 and
does not cover Windows/x64, signing, notarization, publication, or updates.

Verified on macOS arm64 with Node.js `v24.13.0`. The generated application is
an ignored local artifact at `release/mac-arm64/Org Workbench.app`; it is not
committed, installed, signed by a developer identity, notarized, uploaded, or
published.

## Package verifier

- schema: `org-workbench-package-manifest.v1`
- result: pass
- architecture: arm64 only
- required runtime entries: 30
- sealed/developer signature: absent
- executable linker signature: ad hoc, with no authority or team identifier
- Qoder resolver: present and byte-identical to
  `apps/server/src/qoder-binary.js`
- packaged server runtime contains `dist/src` but no `dist/test`

## Clean-staging smoke

- schema: `org-workbench-clean-staging-smoke.v1`
- result: pass
- application copied outside the source tree before launch
- minimal LaunchServices-style initial PATH
- login-shell recovery imported PATH only; fixture-only environment was absent
- renderer, preload, localStorage, control plane, and Qoder health ready
- fixture Qoder turn completed through an MCP command discoverable only via the
  recovered PATH, then survived history readback
- Workbench control-plane and Qoder fixture PIDs both reached `ESRCH` after exit

## Process boundary isolation

- ordinary operator engine health/version/help, hire, org, and turn commands do
  not receive `ELECTRON_RUN_AS_NODE`, the control-plane boot token, or the
  internal bundled marker
- ordinary health/hire/org commands receive only a non-credential runtime
  allowlist; provider credentials, Context authority, arbitrary settings and
  secrets stay in the control plane
- only the desktop-owned bundled adapter receives exact
  `ELECTRON_RUN_AS_NODE=1`; non-exact values are rejected
- real Qoder and Claude version probes receive a non-credential runtime
  allowlist
- the server forwards binary/permission adapter controls only to the bundled
  Qoder adapter, where unsupported permission modes fail closed; real
  Qoder/MCP descendants receive a positive Qoder
  runtime/credential allowlist and never receive adapter, Electron, boot,
  internal, Context, or arbitrary server variables

## Node 24 repository gate

`npm run check` passed in the final rebased worktree after a clean `npm ci`;
the repository postinstall React deduplication step also completed successfully:

- scripts: 8/8
- UI: 31/31
- server: 156 passed, 1 expected E3 skip
- renderer: 155/155
- desktop main: 54/54
- `npm audit`: 0 vulnerabilities
- `npm audit --omit=dev`: 0 vulnerabilities

The skipped server E3 case is the existing real-host context-export lane and is
not converted into package evidence by this partial foundation.
