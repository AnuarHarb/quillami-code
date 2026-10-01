import type { EventEmitter } from "node:events";
import type { Interface } from "node:readline/promises";
import { dim } from "./banner.js";

const IDLE_EXIT_WINDOW_MS = 2000;

export type TurnInterrupter = {
  /** Runs one turn with its own AbortSignal; Ctrl+C aborts only that turn. */
  run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T | undefined>;
  signal(): AbortSignal | undefined;
  /** For tests and non-readline sources: same as pressing Ctrl+C. */
  interrupt(): void;
  dispose(): void;
};

export type InterrupterOptions = {
  rl?: Interface | null;
  signalSource?: EventEmitter;
  write?: (text: string) => void;
  exit?: (code: number) => void;
  now?: () => number;
};

/**
 * Ctrl+C during a turn cancels the turn and keeps the session; a second one
 * while it is still cancelling exits. At the idle prompt the first Ctrl+C
 * clears the line and the second, within two seconds, exits.
 */
export function createTurnInterrupter(options: InterrupterOptions = {}): TurnInterrupter {
  const rl = options.rl ?? null;
  const signalSource = options.signalSource ?? process;
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const now = options.now ?? Date.now;

  let active: AbortController | null = null;
  let lastIdleInterrupt = Number.NEGATIVE_INFINITY;

  const interrupt = () => {
    if (active) {
      if (active.signal.aborted) {
        write("\n");
        exit(130);
        return;
      }
      active.abort();
      write(`\n${dim("  cancelando el turno… (Ctrl+C otra vez para salir)")}\n`);
      return;
    }

    if (!rl) {
      exit(130);
      return;
    }
    const time = now();
    if (time - lastIdleInterrupt < IDLE_EXIT_WINDOW_MS) {
      rl.close();
      return;
    }
    lastIdleInterrupt = time;
    rl.write(null, { ctrl: true, name: "e" });
    rl.write(null, { ctrl: true, name: "u" });
    write(`\n${dim("  (Ctrl+C otra vez o /exit para salir)")}\n`);
    rl.prompt(true);
  };

  rl?.on("SIGINT", interrupt);
  signalSource.on("SIGINT", interrupt);

  return {
    async run(task) {
      const controller = new AbortController();
      active = controller;
      try {
        return await task(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
        write(`${dim("  turno cancelado; la sesión sigue.")}\n\n`);
        return undefined;
      } finally {
        active = null;
      }
    },
    signal() {
      return active?.signal;
    },
    interrupt,
    dispose() {
      rl?.off("SIGINT", interrupt);
      signalSource.off("SIGINT", interrupt);
    },
  };
}
