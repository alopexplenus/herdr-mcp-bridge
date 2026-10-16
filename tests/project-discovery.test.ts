import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";
import { agentProject, discoverProjects } from "../src/project-discovery.js";

const roots: string[] = [];

async function temporaryProjectsRoot() {
  await mkdir(path.join(os.homedir(), "projects"), { recursive: true });
  return mkdtemp(path.join(os.homedir(), "projects", "herdr-test-"));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("discoverProjects", () => {
  test("lists only immediate child directory names, sorted", async () => {
    const root = await temporaryProjectsRoot();
    roots.push(root);
    await mkdir(path.join(root, "zeta", ".git"), { recursive: true });
    await mkdir(path.join(root, "alpha"));
    await mkdir(path.join(root, "zeta", "nested"));
    await writeFile(path.join(root, "not-a-directory"), "file");

    expect(discoverProjects(root)).toEqual(["alpha", "zeta"]);
  });

  test("accepts a discovery root outside HOME", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "herdr-outside-"));
    roots.push(root);
    await mkdir(path.join(root, "alpha"));

    expect(discoverProjects(root)).toEqual(["alpha"]);
  });

  test("rejects a missing discovery root", () => {
    expect(() => discoverProjects(path.join(os.tmpdir(), `herdr-missing-${process.pid}`))).toThrow(/not accessible/);
  });

  test("allows direct-child names beginning with ..", async () => {
    const root = await temporaryProjectsRoot();
    roots.push(root);
    await mkdir(path.join(root, "..fixture"));

    expect(discoverProjects(root)).toEqual(["..fixture"]);
  });
});

describe("agentProject", () => {
  test("uses the project directory containing the agent cwd", async () => {
    const root = await temporaryProjectsRoot();
    roots.push(root);
    const agent = { projectId: "wX", cwd: path.join(root, "beta", "sub") };
    expect(agentProject(agent, root)).toBe("beta");
    expect(agentProject({ ...agent, cwd: "/elsewhere/other" }, root)).toBe("other");
  });
});
