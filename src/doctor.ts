import { accessSync, constants, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { noul } from "@typesafe-ai/sdk";
import { benchmarksEnabled } from "./benchmarks.js";
import { askJev, jevEnabled } from "./jev.js";
import { configDir } from "./config.js";
import { hasKey } from "./auth.js";
import { defaultModel } from "./models.js";
import { anyProviderKey, createClient } from "./providers.js";
import { connectMcpServers } from "./mcp.js";
import { discoverSkills, skillsBannerLine } from "./skills.js";
import { packageVersion } from "./version.js";

/** `optional` lines that are not ok show as "--", not "fail". */
export type DoctorLine = { label: string; ok: boolean; detail: string; optional?: boolean };

export async function runDoctor(): Promise<{ lines: DoctorLine[]; exitCode: number }> {
  const lines: DoctorLine[] = [];

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  lines.push({
    label: "node",
    ok: nodeMajor >= 22,
    detail: nodeMajor >= 22 ? `v${process.versions.node}` : `need >=22, got ${process.versions.node}`,
  });

  let configOk = false;
  try {
    mkdirSync(configDir(), { recursive: true });
    accessSync(configDir(), constants.W_OK);
    configOk = true;
  } catch {
    configOk = false;
  }
  lines.push({
    label: "config dir",
    ok: configOk,
    detail: configOk ? configDir() : `cannot write ${configDir()}`,
  });

  const modelKey = anyProviderKey();
  lines.push({
    label: "openrouter key",
    ok: hasKey("openrouter"),
    optional: modelKey,
    detail: hasKey("openrouter") ? "present" : modelKey ? "optional OPENROUTER_API_KEY" : "missing OPENROUTER_API_KEY (or ANTHROPIC_API_KEY)",
  });
  lines.push({
    label: "anthropic key",
    ok: hasKey("anthropic"),
    optional: true,
    detail: hasKey("anthropic") ? "present" : "optional ANTHROPIC_API_KEY",
  });
  if (hasKey("minimax")) lines.push({ label: "minimax key", ok: true, detail: "present" });
  lines.push({
    label: "typesafe key",
    ok: jevEnabled(),
    optional: true,
    detail: jevEnabled() ? "present (Jev on)" : "optional TYPESAFE_API_KEY (auto, smart permissions)",
  });
  const aaKey = Boolean(process.env.ARTIFICIAL_ANALYSIS_API_KEY?.trim());
  lines.push({
    label: "benchmarks key",
    ok: aaKey,
    optional: true,
    detail: !aaKey
      ? "optional ARTIFICIAL_ANALYSIS_API_KEY"
      : benchmarksEnabled()
        ? "present (auto picks by benchmark)"
        : "present, needs OPENROUTER_API_KEY too",
  });

  lines.push({
    label: "package",
    ok: true,
    detail: `quillami-code@${packageVersion()}`,
  });

  try {
    const which = execFileSync("which", ["quillami"], { encoding: "utf8" }).trim();
    lines.push({ label: "global bin", ok: true, detail: which });
  } catch {
    lines.push({
      label: "global bin",
      ok: true,
      detail: "quillami not on PATH (ok if using npx or npm start)",
    });
  }

  if (anyProviderKey()) {
    const model = defaultModel();
    try {
      const client = createClient(model);
      await client.messages.create({
        model: model.id,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
      lines.push({
        label: "provider ping",
        ok: true,
        detail: `${model.provider} · ${model.id}`,
      });
    } catch (error) {
      lines.push({
        label: "provider ping",
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    lines.push({
      label: "provider ping",
      ok: false,
      detail: "skipped (no provider key)",
    });
  }

  if (jevEnabled()) {
    const answer = await askJev("doctor ping", { ping: noul("Is this a test?") });
    lines.push({
      label: "jev",
      ok: answer !== null,
      detail: answer !== null ? "answered" : "askJev returned null",
    });
  }

  let mcpOk = true;
  let mcpDetail = "no servers or all connected";
  try {
    const runtime = await connectMcpServers((message) => {
      mcpOk = false;
      mcpDetail = message;
    });
    mcpDetail = runtime.bannerLine();
    await runtime.close();
  } catch (error) {
    mcpOk = false;
    mcpDetail = error instanceof Error ? error.message : String(error);
  }
  lines.push({ label: "mcp", ok: mcpOk, detail: mcpDetail });

  const skills = discoverSkills();
  lines.push({
    label: "skills",
    ok: skills.length > 0,
    detail: skillsBannerLine(skills).replace(/^skills: /, ""),
    optional: true,
  });

  const critical = lines.filter(
    (line) =>
      !line.ok &&
      (line.label === "node" ||
        line.label === "config dir" ||
        line.label === "provider ping"),
  );

  return { lines, exitCode: critical.length > 0 ? 1 : 0 };
}

export function formatDoctorReport(lines: DoctorLine[]): string {
  return lines
    .map((line) => `  ${(line.ok ? "ok" : line.optional ? "--" : "fail").padEnd(4)}  ${line.label}: ${line.detail}`)
    .join("\n");
}
