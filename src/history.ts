import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { Run } from "./model";

export class HistoryStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private directory: string,
    private limit: () => number,
    private warn: (message: string) => void,
  ) {}
  async list(): Promise<Run[]> {
    try {
      const data: unknown = JSON.parse(
        await readFile(path.join(this.directory, "history-v1.json"), "utf8"),
      );
      if (
        !data ||
        typeof data !== "object" ||
        !("schemaVersion" in data) ||
        data.schemaVersion !== 1 ||
        !("runs" in data) ||
        !Array.isArray(data.runs)
      )
        throw new Error("Unsupported or damaged history schema.");
      return (data.runs as Run[])
        .filter(
          (run) =>
            run?.schemaVersion === 1 &&
            typeof run.id === "string" &&
            typeof run.startedAt === "string" &&
            Array.isArray(run.series) &&
            run.metrics &&
            Array.isArray(run.logs),
        )
        .map((run) =>
          ["starting", "running", "stopping"].includes(run.state)
            ? {
                ...run,
                state: "execution_failed" as const,
                logs: [
                  ...run.logs,
                  "Extension host stopped before the run completed.",
                ],
              }
            : run,
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.warn(
          "History could not be read. The original file is retained; new runs will use a recovered history file.",
        );
      return [];
    }
  }
  private update(transform: (runs: Run[]) => Run[]): Promise<void> {
    this.queue = this.queue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const target = path.join(this.directory, "history-v1.json");
        try {
          const original = await readFile(target, "utf8");
          const parsed = JSON.parse(original);
          if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.runs))
            throw new Error("Invalid history");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            await rename(
              target,
              path.join(this.directory, `history-damaged-${Date.now()}.json`),
            );
        }
        const runs = transform(await this.list()).slice(
          0,
          Math.max(1, Math.min(500, this.limit())),
        );
        const temporary = path.join(this.directory, "history-v1.tmp");
        await writeFile(temporary, JSON.stringify({ schemaVersion: 1, runs }), {
          mode: 0o600,
        });
        await rename(temporary, target);
      });
    return this.queue;
  }
  save(run: Run): Promise<void> {
    return this.update((runs) => [run, ...runs.filter((r) => r.id !== run.id)]);
  }
  delete(id: string): Promise<void> {
    return this.update((runs) => runs.filter((r) => r.id !== id));
  }
  clear(): Promise<void> {
    return this.update(() => []);
  }
}
