import os from "node:os";
import path from "node:path";
import { accessSync, readdirSync, realpathSync } from "node:fs";

export interface AgentSummary {
  id: string;
  name: string;
  projectId: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  isGit: boolean;
  agentIds: string[];
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

export function discoverProjects(root: string, agents: AgentSummary[]): ProjectSummary[] {
  const resolvedRoot = path.resolve(root);
  let realRoot: string;
  let realProjectsRoot: string;
  try {
    realRoot = realpathSync(resolvedRoot);
    realProjectsRoot = realpathSync(path.resolve(os.homedir(), "projects"));
  } catch {
    throw new Error("project discovery root must be inside ~/projects");
  }
  if (!isWithinRoot(path.resolve(os.homedir(), "projects"), realProjectsRoot) || !isWithinRoot(realProjectsRoot, realRoot)) {
    throw new Error("project discovery root must be inside ~/projects");
  }

  const entries = readdirSync(realRoot, { withFileTypes: true });
  const projects: ProjectSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectPath = path.join(realRoot, entry.name);
    let isGit = true;
    try {
      accessSync(path.join(projectPath, ".git"));
    } catch {
      isGit = false;
    }
    projects.push({
      id: entry.name,
      name: entry.name,
      path: projectPath,
      isGit,
      agentIds: agents.filter((agent) => agent.projectId === entry.name).map((agent) => agent.id),
    });
  }
  return projects.sort((left, right) => left.name.localeCompare(right.name));
}
