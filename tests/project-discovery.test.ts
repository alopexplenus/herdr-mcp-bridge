import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";
import { discoverProjects, type AgentSummary, type ProjectSummary } from "../src/project-discovery.js";

const roots: string[] = [];

async function temporaryProjectsRoot() {
  await mkdir(path.join(os.homedir(), "projects"), { recursive: true });
  return mkdtemp(path.join(os.homedir(), "projects", "herdr-test-"));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("discoverProjects", () => {
  test("lists only immediate child directories and their git status", async () => {
    const root = await temporaryProjectsRoot();
    roots.push(root);
    await mkdir(path.join(root, "git-project", ".git"), { recursive: true });
    await mkdir(path.join(root, "plain-project"));
    await mkdir(path.join(root, "git-project", "nested", ".git"), { recursive: true });
    await writeFile(path.join(root, "not-a-directory"), "file");

    const projects: ProjectSummary[] = discoverProjects(root, []);

    expect(projects).toEqual([
      { id: "git-project", name: "git-project", path: path.join(root, "git-project"), isGit: true, agentIds: [] },
      { id: "plain-project", name: "plain-project", path: path.join(root, "plain-project"), isGit: false, agentIds: [] },
    ]);
  });

  test("associates agents by project identifier rather than filesystem paths", async () => {
    const root = await temporaryProjectsRoot();
    roots.push(root);
    await mkdir(path.join(root, "alpha"));
    await mkdir(path.join(root, "beta"));
    const agents: AgentSummary[] = [
      { id: "a1", name: "one", projectId: "beta" },
      { id: "a2", name: "two", projectId: "not-a-path" },
    ];

    const projects = discoverProjects(root, agents);

    expect(projects.find((project) => project.id === "beta")?.agentIds).toEqual(["a1"]);
    expect(projects.find((project) => project.id === "alpha")?.agentIds).toEqual([]);
  });

  test("rejects a discovery root outside ~/projects", async () => {
    expect(() => discoverProjects(os.tmpdir(), [])).toThrow(/projects/i);
  });

  test("allows direct-child names beginning with ..", async () => {
    const root = await temporaryProjectsRoot();
    roots.push(root);
    await mkdir(path.join(root, "..fixture"));

    expect(discoverProjects(root, [])).toEqual([
      { id: "..fixture", name: "..fixture", path: path.join(root, "..fixture"), isGit: false, agentIds: [] },
    ]);
  });

  test("rejects a symlinked root that resolves outside ~/projects", async () => {
    const root = await temporaryProjectsRoot();
    roots.push(root);
    const outside = await mkdtemp(path.join(os.tmpdir(), "herdr-outside-"));
    roots.push(outside);
    const link = path.join(root, "link");
    await symlink(outside, link, "dir");

    expect(() => discoverProjects(link, [])).toThrow(/projects/i);
  });
});
