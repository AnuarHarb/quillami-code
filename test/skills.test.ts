import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  discoverSkills,
  expandSkillCommand,
  formatSkillIndex,
  loadSkill,
  parseFrontmatter,
  readSkillFile,
  skillRoots,
} from "../src/skills.ts";
import { createToolRegistry } from "../src/toolRegistry.ts";

async function addSkill(root: string, dir: string, frontmatter: string, body = "Haz esto.") {
  await mkdir(path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}\n`);
}

describe("skills", () => {
  let base = "";
  let project = "";
  let home = "";

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "quillami-skills-"));
    project = path.join(base, "project");
    home = path.join(base, "home");
    await mkdir(project);
    await mkdir(home);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("reads plain, quoted and folded frontmatter", () => {
    const folded = parseFrontmatter("---\nname: 'animate'\ndescription: >\n  Build an\n  animation.\nextra: x\n---\n# Body\n");
    assert.deepEqual(folded.meta, { name: "animate", description: "Build an animation.", extra: "x" });
    assert.equal(folded.body, "# Body\n");
    assert.deepEqual(parseFrontmatter("no frontmatter").meta, {});
  });

  it("finds skills in the project and home folders, Quillami's own and the compatible ones", async () => {
    await addSkill(path.join(project, ".quillami/skills"), "deploy", "name: deploy\ndescription: Sube a producción.");
    await addSkill(path.join(home, ".claude/skills"), "animate", "name: animate\ndescription: Anima cosas.");
    await addSkill(path.join(home, ".agents/skills"), "swift", "name: write-swift\ndescription: Swift moderno.");
    await addSkill(path.join(home, ".agents/skills"), "broken", "name: broken");

    const skills = discoverSkills(skillRoots(project, home));
    assert.deepEqual(skills.map((skill) => skill.name), ["deploy", "animate", "write-swift"]);
  });

  it("lets a project skill override a global one, and lists a symlinked skill once", async () => {
    const agents = path.join(home, ".agents/skills");
    await addSkill(agents, "animate", "name: animate\ndescription: Global.");
    await mkdir(path.join(home, ".claude/skills"), { recursive: true });
    await symlink(path.join(agents, "animate"), path.join(home, ".claude/skills/animate"));
    await addSkill(path.join(project, ".claude/skills"), "animate", "name: animate\ndescription: Del proyecto.");

    const skills = discoverSkills(skillRoots(project, home));
    assert.equal(skills.length, 1);
    assert.equal(skills[0].description, "Del proyecto.");

    const globalOnly = discoverSkills(skillRoots(path.join(base, "empty"), home));
    assert.equal(globalOnly.length, 1);
    assert.equal(globalOnly[0].root, path.join(home, ".claude/skills"));
  });

  it("keeps manual-only skills out of the model's index but still runs them with /name", async () => {
    const root = path.join(home, ".agents/skills");
    await addSkill(root, "animate", "name: animate\ndescription: Anima cosas.");
    await addSkill(root, "prototype", "name: prototype\ndescription: Variantes.\ndisable-model-invocation: true", "Haz 3 versiones.");
    const skills = discoverSkills([root]);

    const index = formatSkillIndex(skills);
    assert.match(index, /- animate: Anima cosas\./);
    assert.doesNotMatch(index, /prototype/);

    const message = expandSkillCommand("/prototype un botón de pago", skills)!;
    assert.match(message, /started the "prototype" skill/);
    assert.match(message, /Haz 3 versiones\./);
    assert.match(message, /Request: un botón de pago/);
    assert.equal(expandSkillCommand("/nada hola", skills), null);
    assert.equal(expandSkillCommand("hola", skills), null);
  });

  it("loads the instructions with the list of supporting files, and reads only inside the skill", async () => {
    const root = path.join(home, ".agents/skills");
    await addSkill(root, "animate", "name: animate\ndescription: Anima cosas.", "# Animar\nUsa springs.");
    await mkdir(path.join(root, "animate/references"));
    await writeFile(path.join(root, "animate/references/springs.md"), "stiffness 300\n");
    await writeFile(path.join(home, "secret.txt"), "no\n");
    const [skill] = discoverSkills([root]);

    const loaded = loadSkill(skill);
    assert.match(loaded, /# Animar\nUsa springs\./);
    assert.doesNotMatch(loaded, /description:/);
    assert.match(loaded, /- references\/springs\.md/);
    assert.equal(readSkillFile(skill, "references/springs.md"), "stiffness 300\n");
    assert.throws(() => readSkillFile(skill, "../../secret.txt"), /outside the animate skill folder/);
  });

  it("offers the skill tool only when there are skills, also in plan mode", async () => {
    assert.ok(!createToolRegistry().definitions("agent").some((tool) => tool.name === "skill"));

    const root = path.join(home, ".agents/skills");
    await addSkill(root, "animate", "name: animate\ndescription: Anima cosas.", "Usa springs.");
    const registry = createToolRegistry({ skills: discoverSkills([root]) });
    assert.ok(registry.definitions("plan").some((tool) => tool.name === "skill"));
    assert.match(await registry.execute("skill", { name: "Animate" }), /Usa springs\./);
    await assert.rejects(registry.execute("skill", { name: "nope" }), /Available: animate/);
  });
});
