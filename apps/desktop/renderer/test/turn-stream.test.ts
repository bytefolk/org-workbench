import { describe, expect, it } from "vitest";
import {
  EMPTY_TURN_STREAM,
  applyTurnEvent,
  beginPendingTurn,
  cancelPendingTurn,
  settlePendingTurn,
} from "../src/turns/turnStream";

const pending = { positionId: "repo-owner", engine: "qoder" as const, input: "检查发布" };

function started(seq: number, runId: string) {
  return { seq, type: "turn.started", payload: { runId, timestamp: "2026-08-24T05:00:00.000Z", type: "run.started" } };
}

function delta(seq: number, runId: string, text: string) {
  return { seq, type: "turn.model.delta", payload: { runId, timestamp: "2026-08-24T05:00:01.000Z", type: "model.delta", text } };
}

describe("turn stream reducer", () => {
  it("binds the first observed runId to the pending POST and appends deltas", () => {
    let state = beginPendingTurn(EMPTY_TURN_STREAM, pending);
    state = applyTurnEvent(state, started(1, "run-1"));
    state = applyTurnEvent(state, delta(2, "run-1", "正在分析"));
    state = applyTurnEvent(state, delta(3, "run-1", "…已核对"));

    expect(state.pending?.runId).toBe("run-1");
    expect(state.runs["run-1"]?.text).toBe("正在分析…已核对");
    expect(state.runs["run-1"]?.positionId).toBe("repo-owner");
    expect(state.runs["run-1"]?.input).toBe("检查发布");
  });

  it("buffers a delta that arrives before turn.started", () => {
    let state = beginPendingTurn(EMPTY_TURN_STREAM, pending);
    state = applyTurnEvent(state, delta(1, "run-1", "早到文本"));
    state = applyTurnEvent(state, started(2, "run-1"));

    expect(state.runs["run-1"]?.text).toBe("早到文本");
    expect(state.pending?.runId).toBe("run-1");
  });

  it("never attributes a run when no POST is pending", () => {
    const state = applyTurnEvent(EMPTY_TURN_STREAM, delta(1, "run-9", "无主增量"));
    expect(state.runs).toEqual({});
    expect(state.seq).toBe(1);
  });

  it("does not steal a runId once pending is bound to another run", () => {
    let state = beginPendingTurn(EMPTY_TURN_STREAM, pending);
    state = applyTurnEvent(state, started(1, "run-1"));
    state = applyTurnEvent(state, delta(2, "run-2", "别人的增量"));
    expect(Object.keys(state.runs)).toEqual(["run-1"]);
  });

  it("treats replayed envelopes at or below the processed seq as no-ops", () => {
    let state = beginPendingTurn(EMPTY_TURN_STREAM, pending);
    state = applyTurnEvent(state, started(1, "run-1"));
    state = applyTurnEvent(state, delta(2, "run-1", "唯一一次"));
    const replayed = applyTurnEvent(state, delta(2, "run-1", "唯一一次"));
    const stale = applyTurnEvent(state, delta(1, "run-1", "更早的重放"));

    expect(replayed.runs["run-1"]?.text).toBe("唯一一次");
    expect(stale.runs["run-1"]?.text).toBe("唯一一次");
    expect(replayed).toBe(state);
  });

  it("drops the live buffer on the matching terminal event", () => {
    let state = beginPendingTurn(EMPTY_TURN_STREAM, pending);
    state = applyTurnEvent(state, started(1, "run-1"));
    state = applyTurnEvent(state, delta(2, "run-1", "过程文本"));
    state = applyTurnEvent(state, {
      seq: 3,
      type: "turn.completed",
      payload: { runId: "run-1", timestamp: "2026-08-24T05:00:02.000Z", type: "run.completed", output: "结果", terminalReason: "goal_met" },
    });
    expect(state.runs).toEqual({});
  });

  it("scopes turn.indeterminate cleanup to the reported position", () => {
    let state = beginPendingTurn(EMPTY_TURN_STREAM, pending);
    state = applyTurnEvent(state, started(1, "run-1"));
    state = {
      ...state,
      runs: {
        ...state.runs,
        "run-2": { positionId: "docs-writer", engine: "qoder", input: "其他岗位", text: "别处", startedAt: "2026-08-24T05:00:00.000Z", totalTokens: null },
      },
    };
    state = applyTurnEvent(state, {
      seq: 2,
      type: "turn.indeterminate",
      payload: { turnId: "turn-1", positionId: "repo-owner", code: "turn_driver_failure", envelopeDigest: "sha256:x" },
    });
    expect(Object.keys(state.runs)).toEqual(["run-2"]);
  });

  it("settle clears pending and the superseded run once the POST returns", () => {
    let state = beginPendingTurn(EMPTY_TURN_STREAM, pending);
    state = applyTurnEvent(state, started(1, "run-1"));
    const byRunId = settlePendingTurn(state, { runId: "run-1", positionId: "repo-owner" });
    expect(byRunId.pending).toBeNull();
    expect(byRunId.runs).toEqual({});

    const missed = beginPendingTurn(EMPTY_TURN_STREAM, pending);
    const settled = applyTurnEvent(missed, started(1, "run-1"));
    const byPosition = settlePendingTurn(settled, { runId: null, positionId: "repo-owner" });
    expect(byPosition.runs).toEqual({});
  });

  it("cancel clears only the pending marker", () => {
    const state = beginPendingTurn(EMPTY_TURN_STREAM, pending);
    expect(cancelPendingTurn(state).pending).toBeNull();
  });

  it("records turn.usage totals on the attributed live run", () => {
    let state = beginPendingTurn(EMPTY_TURN_STREAM, pending);
    state = applyTurnEvent(state, started(1, "run-1"));
    expect(state.runs["run-1"]?.totalTokens).toBeNull();
    state = applyTurnEvent(state, {
      seq: 2,
      type: "turn.usage",
      payload: { runId: "run-1", timestamp: "2026-08-24T05:00:01.500Z", type: "usage", inputTokens: 120, outputTokens: 80, totalTokens: 200 },
    });
    expect(state.runs["run-1"]?.totalTokens).toBe(200);
    state = applyTurnEvent(state, {
      seq: 3,
      type: "turn.usage",
      payload: { runId: "run-1", timestamp: "2026-08-24T05:00:02.500Z", type: "usage", totalTokens: 480 },
    });
    expect(state.runs["run-1"]?.totalTokens).toBe(480);
  });

  it("ignores turn.usage for unattributed runs and non-numeric totals", () => {
    let state = beginPendingTurn(EMPTY_TURN_STREAM, pending);
    state = applyTurnEvent(state, started(1, "run-1"));
    const unknownRun = applyTurnEvent(state, {
      seq: 2,
      type: "turn.usage",
      payload: { runId: "run-9", timestamp: "2026-08-24T05:00:01.500Z", type: "usage", totalTokens: 999 },
    });
    expect(unknownRun.runs).toEqual(state.runs);
    const invalid = applyTurnEvent(state, {
      seq: 3,
      type: "turn.usage",
      payload: { runId: "run-1", timestamp: "2026-08-24T05:00:01.500Z", type: "usage", totalTokens: "many" },
    });
    expect(invalid.runs["run-1"]?.totalTokens).toBeNull();
  });
});
