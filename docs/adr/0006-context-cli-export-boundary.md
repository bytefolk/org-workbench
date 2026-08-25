# ADR-0006: Context export uses the public CLI/stdio adapter

## Status

Accepted for org-workbench #15 R1.

## Decision

After an explicit session turn has reached a strictly validated `completed` terminal and its `turn-record.v1` has been durably replaced, the server persists a bounded export intent and invokes the Context provider through `context adapter ingest|distill`.

The initial provider pin is `fullstack-ai-infra/context@f63f57f7b4cb7071309561f0383683017ae79eb2` (context #1 R3). Workbench derives scope and occurrence identity from its durable workspace/session/turn records. It never accepts Context scope or authority from renderer input.

The adapter child receives `CONTEXT_VAULT` and `CONTEXT_RUNTIME_TOKEN` from the server environment only. It does not receive operator credentials, Workbench boot-token, or Qoder/Claude credentials. Workbench neither imports provider implementation packages nor opens the provider SQLite database.

## Consequences

- Provider evolution remains behind a versioned process boundary.
- A committed Host turn is never rolled back or retried because Context is unavailable.
- A process interruption can replay only the idempotent export from workspace-local `pending|failed` evidence.
- Export evidence contains digests and source references, not transcript bodies or credentials.
- Recall, model injection, Memory writes, backfill and Host-private transcript parsing remain separate work.
