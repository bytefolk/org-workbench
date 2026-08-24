import { describe, expect, it } from "vitest";
import type { TurnHistory } from "@org-workbench/shared";
import { adaptTurnHistory } from "../src/turns/adapter";

describe("turn-record.v1 renderer adapter", () => {
  it("maps server-owned history explicitly without inventing recall or evidence", () => {
    const history: TurnHistory = {
      schemaVersion: "turn-history.v1",
      conversationId: "conversation-1",
      positionId: "repo-owner",
      turns: [{
        schemaVersion: "turn-record.v1",
        conversationId: "conversation-1",
        turnId: "turn-1",
        positionId: "repo-owner",
        engine: "qoder",
        status: "completed",
        input: "检查发布门禁",
        envelopeDigest: "sha256:abc",
        createdAt: "2026-08-24T04:00:00.000Z",
        updatedAt: "2026-08-24T04:01:00.000Z",
        events: [],
        output: { result: "pass" },
      }],
    };

    expect(adaptTurnHistory(history, "代码库负责人")).toEqual([{
      id: "turn-1",
      positionId: "repo-owner",
      positionName: "代码库负责人",
      engine: "qoder",
      input: "检查发布门禁",
      status: "completed",
      createdAt: "2026-08-24T04:00:00.000Z",
      completedAt: "2026-08-24T04:01:00.000Z",
      output: "{\n  \"result\": \"pass\"\n}",
      envelopeDigest: "sha256:abc",
    }]);
  });
});
