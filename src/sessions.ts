import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { configDir } from "./config.js";

export type History = Anthropic.MessageParam[];

export type SessionFile = {
  id: string;
  cwd: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  history: History;
};

const MAX_SESSIONS_PER_CWD = 50;

export function sessionsDir(): string {
  return path.join(configDir(), "sessions");
}

export function sessionPath(id: string): string {
  return path.join(sessionsDir(), `${id}.json`);
}

export function createSessionId(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${rand}`;
}

export function titleFromMessage(message: string): string {
  const words = message.trim().split(/\s+/).slice(0, 8);
  const title = words.join(" ");
  return title.length > 60 ? `${title.slice(0, 57)}…` : title || "sesión";
}

export function loadSession(id: string): SessionFile | null {
  const file = sessionPath(id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as SessionFile;
  } catch {
    return null;
  }
}

export function saveSession(session: SessionFile): void {
  mkdirSync(sessionsDir(), { recursive: true, mode: 0o700 });
  const file = sessionPath(session.id);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // ignore
  }
  pruneSessionsForCwd(session.cwd);
}

export function listSessionsForCwd(cwd: string): SessionFile[] {
  if (!existsSync(sessionsDir())) return [];
  const sessions: SessionFile[] = [];
  for (const name of readdirSync(sessionsDir())) {
    if (!name.endsWith(".json")) continue;
    const loaded = loadSession(name.slice(0, -5));
    if (loaded && loaded.cwd === cwd) {
      sessions.push(loaded);
    }
  }
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sessions;
}

export function latestSessionForCwd(cwd: string): SessionFile | null {
  const list = listSessionsForCwd(cwd);
  return list[0] ?? null;
}

export function countUserTurns(history: History): number {
  return history.filter((message) => message.role === "user").length;
}

export function formatSessionsList(cwd: string): string {
  const sessions = listSessionsForCwd(cwd);
  if (sessions.length === 0) {
    return "  (no hay sesiones guardadas en este workspace)";
  }
  return sessions
    .map((session) => {
      const turns = countUserTurns(session.history);
      const date = session.updatedAt.slice(0, 16).replace("T", " ");
      return `  ${session.id}  ${date}  ${turns} turnos  ${session.title}`;
    })
    .join("\n");
}

function pruneSessionsForCwd(cwd: string): void {
  const sessions = listSessionsForCwd(cwd);
  if (sessions.length <= MAX_SESSIONS_PER_CWD) return;
  for (const old of sessions.slice(MAX_SESSIONS_PER_CWD)) {
    try {
      unlinkSync(sessionPath(old.id));
    } catch {
      // ignore
    }
  }
}
