# Issue #104 — bundled Qoder readiness / live E4 evidence

Evidence time: `2026-09-01T06:28:20Z`

Consumed baseline: `4d20c6ae82851488f9e6f8231ffbdae6077d58cd`

Requirement decision: Issue #104 R2

## Public-safe environment

- macOS local source checkout
- Node `24.13.0`
- Qoder CLI `1.1.31`
- bundled engine `qoder-engine 0.1.0`
- normal inherited user PATH; packaged Finder login-PATH restoration is the follow-up consumer #106, not a #104 completion dependency

No account state, credential store, environment value, absolute user path, boot token, raw private prompt, or model response was printed or persisted as evidence. The live prompt and expected response used only the fixed public probe tokens shown below.

## Resolver / health result

The built server probed the bundled engine, resolved the same executable used by the turn adapter, and returned this redacted fact set:

```json
{
  "engine": { "available": true, "version": "qoder-engine 0.1.0" },
  "localQoder": { "installed": true, "version": "1.1.31", "supported": true },
  "qoderHost": { "configured": true, "ready": true }
}
```

The probe invoked only `--version`, with `shell: false`, a timeout, a non-ignorable kill signal, and a bounded output buffer. Unit/integration negatives cover an invalid explicit override, directory/non-executable targets, missing binary, timeout (including a child that ignores `SIGTERM`), unsupported version, raw-output non-disclosure, normal Digital Employee PAT behavior, PATH discovery, absolute macOS known-install discovery, and adversarial relative/control-character-bearing `HOME` values. These last process/path cases were added after independent review; no second live-provider invocation was needed.

## Real engine smoke

A disposable workspace invoked the actual bundled adapter and local Qoder with the fixed instruction:

`Return exactly OWB_QODER_E4_OK. Do not read, create, edit, or delete any file.`

Observed public facts:

```json
{
  "eventTypes": ["run.started", "model.delta", "usage", "run.completed"],
  "terminalType": "run.completed",
  "terminalReason": "goal_met",
  "fixedProbeMatched": true,
  "stderrPresent": false
}
```

## Real Workbench HTTP E4

A second disposable workspace contained one addressed `open-source-dev` position. The built control plane used the bundled engine and completed the fixed instruction:

`Return exactly OWB_QODER_HTTP_E4_OK. Do not read, create, edit, or delete any file.`

The harness retained the boot token only in memory, performed `GET /health`, `POST /workspace/open`, `POST /turns` and `GET /turns?positionId=open-source-dev`, then removed the workspace. Observed public facts:

```json
{
  "health": { "engineAvailable": true, "qoderConfigured": true, "qoderReady": true },
  "workspaceOpened": true,
  "postStatus": 200,
  "terminalStatus": "completed",
  "completedEvent": true,
  "fixedProbeMatched": true,
  "historyStatus": 200,
  "durableReadback": true,
  "sameTurn": true
}
```

This proves one local provider execution and durable Workbench readback. It does not claim general remote entitlement, Claude readiness, packaged-app acceptance, or arbitrary MCP/tool availability.
