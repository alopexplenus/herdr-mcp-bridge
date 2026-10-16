import path from "node:path";
import { readdirSync, realpathSync } from "node:fs";

export function discoverProjects(root: string): string[] {
  let realRoot: string;
  try {
    realRoot = realpathSync(path.resolve(root));
  } catch {
    throw new Error("project discovery root is not accessible");
  }

  const entries = readdirSync(realRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

/** Project name for an agent: the first directory under the projects root containing its cwd, else the cwd's basename. */
export function agentProject(agent: { cwd?: string; projectId?: string }, root: string): string | null {
  if (!agent.cwd) return agent.projectId || null;
  let realRoot = root;
  try {
    realRoot = realpathSync(path.resolve(root));
  } catch {}
  const relative = path.relative(realRoot, path.resolve(agent.cwd));
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.split(path.sep)[0];
  return path.basename(agent.cwd) || null;
}
