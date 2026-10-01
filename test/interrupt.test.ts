import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Interface } from "node:readline/promises";
import { describe, it } from "node:test";
import { createTurnInterrupter } from "../src/interrupt.ts";

function fakeReadline() {
  const emitter = new EventEmitter() as EventEmitter & {
    closed: boolean;
    prompts: number;
    write: () => void;
    prompt: () => void;
    close: () => void;
  };
  emitter.closed = false;
  emitter.prompts = 0;
  emitter.write = () => {};
  emitter.prompt = () => {
    emitter.prompts += 1;
  };
  emitter.close = () => {
    emitter.closed = true;
  };
  return emitter;
}

describe("turn interrupter", () => {
  it("Ctrl+C aborts the running turn and the session continues", async () => {
    const exits: number[] = [];
    const interrupter = createTurnInterrupter({
      signalSource: new EventEmitter(),
      write: () => {},
      exit: (code) => exits.push(code),
    });

    const result = await interrupter.run(async (signal) => {
      interrupter.interrupt();
      assert.equal(signal.aborted, true);
      return "terminó";
    });

    assert.equal(result, "terminó");
    assert.deepEqual(exits, []);
    assert.equal(interrupter.signal(), undefined);
    interrupter.dispose();
  });

  it("swallows the abort error of a cancelled turn", async () => {
    const interrupter = createTurnInterrupter({
      signalSource: new EventEmitter(),
      write: () => {},
      exit: () => {},
    });
    const result = await interrupter.run(async (signal) => {
      interrupter.interrupt();
      signal.throwIfAborted();
      return "nunca";
    });
    assert.equal(result, undefined);
    interrupter.dispose();
  });

  it("a second Ctrl+C while cancelling exits with 130", async () => {
    const exits: number[] = [];
    const interrupter = createTurnInterrupter({
      signalSource: new EventEmitter(),
      write: () => {},
      exit: (code) => exits.push(code),
    });
    await interrupter.run(async () => {
      interrupter.interrupt();
      interrupter.interrupt();
    });
    assert.deepEqual(exits, [130]);
    interrupter.dispose();
  });

  it("at the idle prompt, the first Ctrl+C clears and the second closes", () => {
    const rl = fakeReadline();
    let time = 1_000;
    const interrupter = createTurnInterrupter({
      rl: rl as unknown as Interface,
      signalSource: new EventEmitter(),
      write: () => {},
      exit: () => assert.fail("should close readline, not exit"),
      now: () => time,
    });

    rl.emit("SIGINT");
    assert.equal(rl.closed, false);
    assert.equal(rl.prompts, 1);

    time += 5_000;
    rl.emit("SIGINT");
    assert.equal(rl.closed, false);

    time += 500;
    rl.emit("SIGINT");
    assert.equal(rl.closed, true);
    interrupter.dispose();
  });

  it("without readline, an idle Ctrl+C exits", () => {
    const exits: number[] = [];
    const source = new EventEmitter();
    const interrupter = createTurnInterrupter({
      signalSource: source,
      write: () => {},
      exit: (code) => exits.push(code),
    });
    source.emit("SIGINT");
    assert.deepEqual(exits, [130]);
    interrupter.dispose();
    assert.equal(source.listenerCount("SIGINT"), 0);
  });
});
