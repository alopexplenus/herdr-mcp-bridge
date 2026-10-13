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

export function discoverProjects(root: string, agents: AgentSummary[]): ProjectSummary[] {
  let realRoot: string;
  try {
    realRoot = realpathSync(path.resolve(root));
  } catch {
    throw new Error("project discovery root is not accessible");
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
