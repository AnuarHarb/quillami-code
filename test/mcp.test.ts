import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandEnvTemplate,
  filterMcpTools,
  mcpExposedName,
  parseMcpExposedName,
} from "../src/mcp.ts";

describe("mcp helpers", () => {
  it("expands env templates", () => {
    process.env.TEST_MCP_KEY = "secret";
    assert.equal(expandEnvTemplate("Bearer ${TEST_MCP_KEY}"), "Bearer secret");
    delete process.env.TEST_MCP_KEY;
  });

  it("builds stable exposed names", () => {
    assert.equal(mcpExposedName("easybits", "read_file"), "mcp__easybits__read_file");
    const parsed = parseMcpExposedName("mcp__easybits__read_file");
    assert.deepEqual(parsed, { server: "easybits", tool: "read_file" });
  });

  it("filters tool allow lists", () => {
    const all = ["a", "b", "c"];
    assert.deepEqual(filterMcpTools("srv", all, ["a", "c"]), ["a", "c"]);
    assert.deepEqual(filterMcpTools("srv", all, undefined), all);
  });
});
