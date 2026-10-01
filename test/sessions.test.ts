import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  createSessionId,
  latestSessionForCwd,
  listSessionsForCwd,
  saveSession,
  type SessionFile,
} from "../src/sessions.ts";

describe("sessions", () => {
  let tempHome: string;
  const previousHome = process.env.HOME;

  beforeEach(() => {
    tempHome = path.join("/tmp", `quillami-sessions-${Date.now()}`);
    mkdirSync(tempHome, { recursive: true });
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("saves and lists by cwd", () => {
    const cwd = "/tmp/project-a";
    const session: SessionFile = {
      id: createSessionId(),
      cwd,
      model: "claude-haiku-4-5",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: "hello world",
      history: [{ role: "user", content: "hi" }],
    };
    saveSession(session);
    const list = listSessionsForCwd(cwd);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, session.id);
  });

  it("latest session is most recently updated", () => {
    const cwd = "/tmp/project-b";
    const older: SessionFile = {
      id: "old",
      cwd,
      model: "claude-haiku-4-5",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      title: "old",
      history: [],
    };
    const newer: SessionFile = {
      id: "new",
      cwd,
      model: "claude-haiku-4-5",
      createdAt: "2021-01-01T00:00:00.000Z",
      updatedAt: "2021-01-01T00:00:00.000Z",
      title: "new",
      history: [],
    };
    saveSession(older);
    saveSession(newer);
    assert.equal(latestSessionForCwd(cwd)?.id, "new");
  });
});
