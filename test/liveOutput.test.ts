import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatBashSummary } from "../src/agent/loop.ts";
import { createLiveTail, formatDuration } from "../src/liveOutput.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function capture() {
  const writes: string[] = [];
  return { writes, write: (text: string) => writes.push(text), all: () => writes.join("") };
}

describe("live bash output", () => {
  it("shows only the last lines and erases them on stop", async () => {
    const out = capture();
    const tail = createLiveTail({ write: out.write, windowLines: 2, throttleMs: 0, columns: () => 80 });
    tail.push("uno\ndos\ntres\n");
    await tick();

    assert.doesNotMatch(out.all(), /uno/);
    assert.match(out.all(), /│ dos\n.*│ tres\n/s);

    assert.equal(tail.stop(), 3);
    assert.equal(out.writes.at(-1), "\x1b[2F\x1b[0J");
  });

  it("redraws over the previous window", async () => {
    const out = capture();
    const tail = createLiveTail({ write: out.write, windowLines: 3, throttleMs: 0, columns: () => 80 });
    tail.push("a\nb\n");
    await tick();
    tail.push("c\n");
    await tick();
    assert.ok(out.writes.includes("\x1b[2F\x1b[0J"));
    tail.stop();
  });

  it("keeps only the last rewrite of a progress line and strips colors", async () => {
    const out = capture();
    const tail = createLiveTail({ write: out.write, throttleMs: 0, columns: () => 80 });
    tail.push("\x1b[32mbajando 10%\rbajando 50%\rbajando 90%");
    await tick();
    assert.match(out.all(), /│ bajando 90%/);
    assert.doesNotMatch(out.all(), /10%|\x1b\[32m/);
    tail.stop();
  });

  it("cuts lines to the terminal width so they never wrap", async () => {
    const out = capture();
    const tail = createLiveTail({ write: out.write, throttleMs: 0, columns: () => 30 });
    tail.push(`${"x".repeat(200)}\n`);
    await tick();
    assert.match(out.all(), new RegExp(`│ ${"x".repeat(23)}…`));
    tail.stop();
  });

  it("does nothing after stop", async () => {
    const out = capture();
    const tail = createLiveTail({ write: out.write, throttleMs: 0 });
    tail.stop();
    tail.push("tarde\n");
    await tick();
    assert.equal(out.all(), "");
  });

  it("summarizes exit code, time, and line count", () => {
    assert.equal(formatBashSummary("exit 0\n\nstdout:\nok", 3200, 12), "  exit 0 · 3.2 s · 12 líneas");
    assert.equal(
      formatBashSummary("exit signal SIGTERM\n\nstopped after 5s timeout; retry", 5000, 1),
      "  exit signal SIGTERM · 5.0 s · 1 línea · se pasó del tiempo",
    );
    assert.equal(formatDuration(450), "450 ms");
    assert.equal(formatDuration(125_000), "2 min 5 s");
  });
});
