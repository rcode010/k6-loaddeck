import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  lstat,
  chmod,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

interface Owner {
  schemaVersion: 1;
  hostPid: number;
  enginePid?: number;
  createdAt: number;
}
export async function runDirectory(root = tmpdir()): Promise<string> {
  const directory = await mkdtemp(path.join(root, "loaddeck-"));
  await chmod(directory, 0o700);
  await writeFile(
    path.join(directory, "owner.json"),
    JSON.stringify({
      schemaVersion: 1,
      hostPid: process.pid,
      createdAt: Date.now(),
    } satisfies Owner),
    { mode: 0o600 },
  );
  return directory;
}
export async function recordEngine(
  directory: string,
  pid: number,
): Promise<void> {
  const file = path.join(directory, "owner.json");
  const owner = JSON.parse(await readFile(file, "utf8")) as Owner;
  await writeFile(file, JSON.stringify({ ...owner, enginePid: pid }), {
    mode: 0o600,
  });
}
function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
export async function recoverTemporaryRuns(
  root = tmpdir(),
  minimumAgeMs = 24 * 60 * 60 * 1000,
): Promise<number> {
  let removed = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("loaddeck-")) continue;
    const directory = path.join(root, entry.name);
    try {
      const info = await lstat(directory);
      if (process.getuid && info.uid !== process.getuid()) continue;
      const marker = await lstat(path.join(directory, "owner.json"));
      if (!marker.isFile() || marker.isSymbolicLink() || marker.size > 1024)
        continue;
      const owner: Owner = JSON.parse(
        await readFile(path.join(directory, "owner.json"), "utf8"),
      );
      if (
        owner.schemaVersion !== 1 ||
        !Number.isFinite(owner.createdAt) ||
        Date.now() - owner.createdAt < minimumAgeMs ||
        alive(owner.hostPid) ||
        owner.enginePid === undefined ||
        alive(owner.enginePid)
      )
        continue;
      await rm(directory, { recursive: true, force: true });
      removed++;
    } catch {
      continue;
    }
  }
  return removed;
}
