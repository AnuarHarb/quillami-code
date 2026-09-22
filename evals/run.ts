import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runTurn, type History } from "../src/agent/loop.ts";
import { createCheckpointStore } from "../src/checkpoint.ts";
import { loadEnv } from "../src/env.ts";
import { resolveModel } from "../src/models.ts";
import { type PermissionGate } from "../src/permissions.ts";
import { createUsageLedger } from "../src/usage.ts";
import { withWorkspace } from "../test/workspace.ts";
import { EVAL_CASES } from "./cases.ts";

const allowAll: PermissionGate = {
  authorize: async () => true,
};

const TIMEOUT_MS = 120_000;

async function main(): Promise<void> {
  loadEnv();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("Evals omitidos: no hay ANTHROPIC_API_KEY.");
    process.exit(0);
  }

  const model =
    resolveModel(process.env.QUILLAMI_EVAL_MODEL) ??
    resolveModel(process.env.KILLAMI_EVAL_MODEL) ??
    resolveModel("haiku") ??
    resolveModel("claude-haiku-4-5")!;

  console.log(`evals · modelo ${model.id}\n`);

  let failed = 0;

  for (const evalCase of EVAL_CASES) {
    const started = Date.now();
    try {
      await withTimeout(runCase(evalCase, model), TIMEOUT_MS, evalCase.name);
      console.log(`ok   ${evalCase.name}  ${Date.now() - started}ms`);
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`fail ${evalCase.name}  ${Date.now() - started}ms`);
      console.log(`     ${reason.replaceAll("\n", "\n     ")}\n`);
    }
  }

  if (failed > 0) {
    console.log(`${failed}/${EVAL_CASES.length} evals fallaron.`);
    process.exit(1);
  }

  console.log(`${EVAL_CASES.length}/${EVAL_CASES.length} evals bien.`);
}

async function runCase(
  evalCase: (typeof EVAL_CASES)[number],
  model: string,
): Promise<void> {
  await withWorkspace(async (root) => {
    for (const [relative, content] of Object.entries(evalCase.files)) {
      const full = path.join(root, relative);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, content, "utf8");
    }

    const history: History = [];
    await runTurn(
      evalCase.prompt,
      history,
      allowAll,
      model,
      createCheckpointStore(),
      createUsageLedger({ persist: false }),
    );

    const problem = await evalCase.check(root);
    if (problem) {
      throw new Error(problem);
    }
  });
}

async function withTimeout(
  promise: Promise<void>,
  ms: number,
  name: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${name}: tardó más de ${ms}ms`));
    }, ms);
  });

  try {
    await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

await main();
