import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { defaultEntries, pickModel, renderEntries } from "../src/modelPicker.ts";
import {
  featuredOpenRouterModels,
  searchOpenRouterModels,
  type OpenRouterModel,
} from "../src/openrouter.ts";
import type { Choice, SelectOptions, Selector } from "../src/select.ts";

function model(id: string, created: number, tools = true): OpenRouterModel {
  return {
    id,
    name: id,
    contextLength: 200_000,
    tools,
    created,
    price: { inputPerMillion: 1, outputPerMillion: 2 },
  };
}

const CATALOG: OpenRouterModel[] = [
  model("qwen/qwen3-coder", 100),
  model("qwen/qwen3-coder-next", 300),
  model("qwen/qwen3-coder-plus", 200),
  model("~openai/gpt-sol-latest", 50),
  model("~anthropic/claude-sonnet-latest", 40),
  model("~vendor/no-tools-latest", 10, false),
];

function scripted(answers: string[]) {
  const printed: string[] = [];
  return {
    printed,
    ask: async () => answers.shift() ?? "",
    print: (text: string) => {
      printed.push(text);
    },
  };
}

describe("model picker", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("features only the ~latest aliases that support tools", () => {
    assert.deepEqual(
      featuredOpenRouterModels(CATALOG).map((entry) => entry.id),
      ["~anthropic/claude-sonnet-latest", "~openai/gpt-sol-latest"],
    );
  });

  it("lists search results newest first", () => {
    assert.deepEqual(
      searchOpenRouterModels(CATALOG, "qwen coder").map((entry) => entry.id),
      ["qwen/qwen3-coder-next", "qwen/qwen3-coder-plus", "qwen/qwen3-coder"],
    );
  });

  it("with only OpenRouter, lists auto and the OpenRouter models, without Claude direct", () => {
    const ids = defaultEntries(CATALOG).map((entry) => entry.id);
    assert.deepEqual(ids, ["auto", "~anthropic/claude-sonnet-latest", "~openai/gpt-sol-latest"]);
    assert.match(defaultEntries(CATALOG)[0].line, /Auto \(Jev\)\s+OpenRouter\s+\(falta key de Jev\)/);
    process.env.TYPESAFE_API_KEY = "ts-test";
    assert.doesNotMatch(defaultEntries(CATALOG)[0].line, /falta/);
  });

  it("lists Claude direct models when there is an Anthropic key", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const entries = defaultEntries(CATALOG);
    assert.deepEqual(entries.slice(0, 3).map((entry) => entry.id), ["auto", "sonnet", "sonnet-4.5"]);
    assert.equal(entries.length, 8);
    const text = renderEntries(entries);
    assert.ok(text.indexOf("Recomendado") < text.indexOf("Directos"));
    assert.ok(text.indexOf("Directos") < text.indexOf("OpenRouter ·"));
  });

  it("offers an arrow-key list with sections, the current model highlighted, and live search", async () => {
    let shown: Choice<string>[] = [];
    let options: SelectOptions<string> | undefined;
    const select: Selector = {
      one: async <T,>(_prompt: string, choices: Choice<T>[], given?: SelectOptions<T>) => {
        shown = choices as Choice<string>[];
        options = given as SelectOptions<string>;
        return choices[given?.initial ?? 0].value;
      },
      many: async () => null,
    };
    const picked = await pickModel({
      ...scripted([]),
      select,
      catalog: CATALOG,
      currentId: "~openai/gpt-sol-latest",
    });
    assert.equal(picked, "~openai/gpt-sol-latest");
    assert.deepEqual(
      shown.map((choice) => choice.section?.split(" ·")[0]),
      ["Recomendado", "OpenRouter", "OpenRouter"],
    );
    assert.deepEqual(
      options!.search!("coder").map((choice) => choice.value),
      ["qwen/qwen3-coder-next", "qwen/qwen3-coder-plus", "qwen/qwen3-coder"],
    );
  });

  it("picks by number from the default list", async () => {
    const io = scripted(["3"]);
    assert.equal(await pickModel({ ...io, catalog: CATALOG }), "~openai/gpt-sol-latest");
  });

  it("searches on free text, then picks from the results", async () => {
    const io = scripted(["qwen coder", "1"]);
    assert.equal(await pickModel({ ...io, catalog: CATALOG }), "qwen/qwen3-coder-next");
    assert.ok(io.printed.some((text) => text.includes('"qwen coder"')));
  });

  it("accepts an alias or a vendor/model id typed directly", async () => {
    assert.equal(await pickModel({ ...scripted(["haiku"]), catalog: CATALOG }), "haiku");
    assert.equal(
      await pickModel({ ...scripted(["deepseek/deepseek-chat"]), catalog: CATALOG }),
      "deepseek/deepseek-chat",
    );
  });

  it("re-asks on a missing option or an empty search, and Enter leaves", async () => {
    const io = scripted(["99", "zzzz", ""]);
    assert.equal(await pickModel({ ...io, catalog: CATALOG }), null);
    assert.ok(io.printed.some((text) => text.includes("no hay opción 99")));
    assert.ok(io.printed.some((text) => text.includes('nada con tools que coincida con "zzzz"')));
  });

  it("starts on search results when given a query", async () => {
    const io = scripted(["2"]);
    assert.equal(
      await pickModel({ ...io, catalog: CATALOG, query: "qwen" }),
      "qwen/qwen3-coder-plus",
    );
  });

  it("without the catalog, still offers Sonnet via OpenRouter", async () => {
    const io = scripted(["2"]);
    assert.equal(await pickModel({ ...io, catalog: null }), "openrouter");
  });
});
