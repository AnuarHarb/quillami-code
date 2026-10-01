import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  KEY_SLOTS,
  markOnboardingDone,
  onboardingDone,
  parseSelection,
  renderKeyStatus,
  runOnboarding,
  verifyKey,
  type KeyCheck,
  type KeySlot,
} from "../src/onboarding.ts";
import type { Choice, SelectOptions, Selector } from "../src/select.ts";

const KEY_VARS = KEY_SLOTS.map((slot) => slot.envVar);

function slot(id: KeySlot["id"]): KeySlot {
  return KEY_SLOTS.find((entry) => entry.id === id)!;
}

function scriptedIO(answers: string[], secrets: string[]) {
  const printed: string[] = [];
  return {
    printed,
    io: {
      ask: async () => answers.shift() ?? "",
      secret: async () => secrets.shift() ?? null,
      print: (text: string) => {
        printed.push(text);
      },
    },
  };
}

describe("onboarding", () => {
  const saved = { ...process.env };
  let dir = "";
  let userFile = "";
  let projectFile = "";

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "quillami-onboarding-"));
    process.env.HOME = dir;
    userFile = path.join(dir, "user.env");
    projectFile = path.join(dir, "project.env");
    for (const name of KEY_VARS) delete process.env[name];
  });

  afterEach(async () => {
    process.env = { ...saved };
    await rm(dir, { recursive: true, force: true });
  });

  it("parses the slot selection", () => {
    assert.deepEqual(parseSelection("1 2").map((entry) => entry.id), ["openrouter", "typesafe"]);
    assert.deepEqual(parseSelection("3,3").map((entry) => entry.id), ["anthropic"]);
    assert.deepEqual(parseSelection(""), []);
    assert.equal(parseSelection("9"), null);
    assert.equal(parseSelection("openrouter"), null);
  });

  it("recommends OpenRouter plus Jev and explains what each one adds", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-existing";
    const { io, printed } = scriptedIO([""], []);
    await runOnboarding(io, { userEnvFile: userFile, projectEnvFile: projectFile });
    const text = printed.join("\n");
    assert.match(text, /Recomendado: OpenRouter \+ Jev/);
    assert.match(text, /con Jev, el modo auto elige el mejor para cada tarea/);
    assert.match(text, /Solo OpenRouter también sirve \(modelo fijo\)/);
    const status = renderKeyStatus(userFile, projectFile);
    assert.match(status, /^ {2}1 {2}OpenRouter/);
    assert.match(status, /\n {2}2 {2}Jev \(TypeSafe\)/);
  });

  it("verifies and saves the chosen keys", async () => {
    const saves: Array<[string, string]> = [];
    const verified: string[] = [];
    const { io } = scriptedIO(["1 2"], ["sk-or-good", "ts-key"]);
    const result = await runOnboarding(io, {
      verify: async (entry) => {
        verified.push(entry.id);
        return entry.id === "openrouter" ? "ok" : "skipped";
      },
      save: (envVar, value) => saves.push([envVar, value]),
      userEnvFile: userFile,
      projectEnvFile: projectFile,
    });
    assert.deepEqual(result, { added: ["openrouter", "typesafe"], hasModelKey: true });
    assert.deepEqual(verified, ["openrouter", "typesafe"]);
    assert.deepEqual(saves, [
      ["OPENROUTER_API_KEY", "sk-or-good"],
      ["TYPESAFE_API_KEY", "ts-key"],
    ]);
    assert.equal(process.env.OPENROUTER_API_KEY, "sk-or-good");
  });

  it("offers the keys as a checkbox list with the missing recommended ones checked", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-existing";
    let shown: Choice<KeySlot>[] = [];
    let validate: ((values: KeySlot[]) => string | null) | undefined;
    const select: Selector = {
      one: async () => null,
      many: async <T,>(_prompt: string, choices: Choice<T>[], options?: SelectOptions<T>) => {
        shown = choices as Choice<KeySlot>[];
        validate = options?.validate as typeof validate;
        return choices.filter((choice) => choice.checked).map((choice) => choice.value);
      },
    };
    const { io, printed } = scriptedIO([], ["sk-or-good", "ts-key"]);
    const result = await runOnboarding(
      { ...io, select },
      { verify: async () => "ok", save: () => {}, userEnvFile: userFile, projectEnvFile: projectFile },
    );
    assert.deepEqual(
      shown.filter((choice) => choice.checked).map((choice) => choice.value.id),
      ["openrouter", "typesafe"],
    );
    assert.match(shown.find((choice) => choice.value.id === "anthropic")!.label, /✓ lista/);
    assert.deepEqual(result.added, ["openrouter", "typesafe"]);
    assert.doesNotMatch(printed.join("\n"), /^ {2}1 {2}OpenRouter/m);

    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    assert.match(validate!([]) ?? "", /al menos una key de modelo/);
  });

  it("does not save a rejected key, and retries when asked", async () => {
    const saves: string[] = [];
    const checks: KeyCheck[] = ["invalid", "ok"];
    const { io, printed } = scriptedIO(["3", "s"], ["bad", "good"]);
    const result = await runOnboarding(io, {
      verify: async () => checks.shift()!,
      save: (_envVar, value) => saves.push(value),
      userEnvFile: userFile,
      projectEnvFile: projectFile,
    });
    assert.deepEqual(saves, ["good"]);
    assert.deepEqual(result.added, ["anthropic"]);
    assert.ok(printed.some((text) => text.includes("rechazó esa key")));
  });

  it("skips a key when the user pastes nothing", async () => {
    const { io } = scriptedIO(["1"], [""]);
    const result = await runOnboarding(io, {
      verify: async () => "ok",
      save: () => assert.fail("nothing to save"),
      userEnvFile: userFile,
      projectEnvFile: projectFile,
    });
    assert.deepEqual(result, { added: [], hasModelKey: false });
  });

  it("insists on a model key when there is none", async () => {
    const { io, printed } = scriptedIO(["", "1"], ["sk-or-good"]);
    const result = await runOnboarding(io, {
      verify: async () => "ok",
      save: () => {},
      userEnvFile: userFile,
      projectEnvFile: projectFile,
    });
    assert.ok(printed.some((text) => text.includes("la recomendada es 1 (OpenRouter)")));
    assert.deepEqual(result.added, ["openrouter"]);
  });

  it("lets Enter through when a model key already exists", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-existing";
    const { io } = scriptedIO([""], []);
    const result = await runOnboarding(io, {
      verify: async () => assert.fail("no key to verify"),
      save: () => assert.fail("nothing to save"),
      userEnvFile: userFile,
      projectEnvFile: projectFile,
    });
    assert.deepEqual(result, { added: [], hasModelKey: true });
  });

  it("offers to copy keys that only live in the project .env", async () => {
    await writeFile(projectFile, "OPENROUTER_API_KEY=sk-or-project\nANTHROPIC_MODEL=x\n");
    process.env.OPENROUTER_API_KEY = "sk-or-project";
    assert.match(renderKeyStatus(userFile, projectFile), /OpenRouter\s+✓ solo aquí/);

    const saves: Array<[string, string]> = [];
    const { io, printed } = scriptedIO(["s", ""], []);
    await runOnboarding(io, {
      save: (envVar, value) => saves.push([envVar, value]),
      userEnvFile: userFile,
      projectEnvFile: projectFile,
    });
    assert.ok(printed.some((text) => text.includes("solo sirven en esta carpeta: OpenRouter")));
    assert.deepEqual(saves, [["OPENROUTER_API_KEY", "sk-or-project"]]);
  });

  it("does not offer the copy when the key is already global", async () => {
    await writeFile(projectFile, "OPENROUTER_API_KEY=sk-or-project\n");
    await writeFile(userFile, "OPENROUTER_API_KEY=sk-or-user\n");
    process.env.OPENROUTER_API_KEY = "sk-or-project";
    const { io, printed } = scriptedIO([""], []);
    await runOnboarding(io, { userEnvFile: userFile, projectEnvFile: projectFile });
    assert.ok(!printed.some((text) => text.includes("solo sirven")));
    assert.match(renderKeyStatus(userFile, projectFile), /OpenRouter\s+✓ lista/);
  });

  it("remembers that onboarding ran", () => {
    assert.equal(onboardingDone(), false);
    markOnboardingDone();
    assert.equal(onboardingDone(), true);
  });

  describe("verifyKey", () => {
    function fakeFetch(status: number, seen: Array<{ url: string; headers: Record<string, string> }>) {
      return (async (url: string, init?: RequestInit) => {
        seen.push({ url, headers: init?.headers as Record<string, string> });
        return new Response("{}", { status });
      }) as unknown as typeof fetch;
    }

    it("checks OpenRouter with a Bearer token only", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-secret";
      const seen: Array<{ url: string; headers: Record<string, string> }> = [];
      assert.equal(await verifyKey(slot("openrouter"), "sk-or-x", fakeFetch(200, seen)), "ok");
      assert.equal(seen[0].url, "https://openrouter.ai/api/v1/key");
      assert.deepEqual(seen[0].headers, { Authorization: "Bearer sk-or-x" });
    });

    it("checks Anthropic with x-api-key", async () => {
      const seen: Array<{ url: string; headers: Record<string, string> }> = [];
      assert.equal(await verifyKey(slot("anthropic"), "sk-ant-x", fakeFetch(401, seen)), "invalid");
      assert.equal(seen[0].url, "https://api.anthropic.com/v1/models?limit=1");
      assert.equal(seen[0].headers["x-api-key"], "sk-ant-x");
    });

    it("reports unknown on network errors and other statuses", async () => {
      const failing = (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch;
      assert.equal(await verifyKey(slot("openrouter"), "k", failing), "unknown");
      assert.equal(await verifyKey(slot("openrouter"), "k", fakeFetch(500, [])), "unknown");
    });

    it("checks Artificial Analysis with x-api-key and skips Jev", async () => {
      const seen: Array<{ url: string; headers: Record<string, string> }> = [];
      assert.equal(await verifyKey(slot("artificialanalysis"), "aa-x", fakeFetch(200, seen)), "ok");
      assert.deepEqual(seen[0].headers, { "x-api-key": "aa-x" });
      assert.equal(await verifyKey(slot("typesafe"), "k", fakeFetch(200, [])), "skipped");
    });

    it("never offers MiniMax", () => {
      assert.ok(!KEY_SLOTS.some((entry) => /minimax/i.test(entry.label)));
    });
  });
});
