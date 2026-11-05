import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  writeFile,
  readFile,
  open,
  rm,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { Aggregator, JsonLines, readSummary } from "./metrics";
import {
  fingerprint,
  generateScript,
  safeConfig,
  safeTarget,
} from "./definition";
import type { Installation, QuickTest, Run } from "./model";

export async function discover(binary: string): Promise<Installation> {
  try {
    const result = await promisify(execFile)(binary, ["version"], {
      timeout: 5000,
      maxBuffer: 8192,
      windowsHide: true,
    });
    const version = result.stdout.trim();
    if (!/k6 v?\d+\.\d+/i.test(version))
      throw new Error("Executable did not identify itself as k6.");
    return { ready: true, version };
  } catch {
    return {
      ready: false,
      version: "Unavailable",
      error:
        "Install Grafana k6 in the extension host environment, or set loaddeck.binaryPath, then retry.",
    };
  }
}
export function redactLog(value: string, secrets: string[] = []): string {
  let result = value
    .replaceAll(String.fromCharCode(27), "")
    .replace(/https?:\/\/[^\s"'<>]+/g, (match) => safeTarget(match));
  for (const secret of secrets
    .filter((s) => s.length > 0)
    .sort((a, b) => b.length - a.length))
    result = result.split(secret).join("[redacted]");
  return result
    .replace(
      /(authorization|cookie|token|password|api[_-]?key)\s*[:=]\s*[^\s,]+/gi,
      "$1=[redacted]",
    )
    .slice(0, 8192);
}
export class K6Runner {
  private child?: ChildProcess;
  private cancelled = false;
  private forceTimer?: NodeJS.Timeout;
  private active?: Run;
  get busy(): boolean {
    return !!this.active;
  }
  async run(
    binary: string,
    version: string,
    onUpdate: (run: Run) => void,
    input: { config: QuickTest } | { script: string },
  ): Promise<Run> {
    if (this.busy)
      throw new Error(
        "A test is already running. Stop it before starting another.",
      );
    const config = "config" in input ? input.config : undefined;
    const script = "script" in input ? input.script : undefined;
    const started = Date.now();
    const run: Run = {
      schemaVersion: 1,
      id: randomUUID(),
      name:
        config?.name ||
        (config ? safeTarget(config.url) : path.basename(script!)),
      testKind: config?.testKind ?? "custom",
      target: config ? safeTarget(config.url) : "Custom script",
      method: config?.method ?? "Script",
      fingerprint: fingerprint(
        config
          ? { ...config, name: undefined }
          : { script, content: await readFile(script!, "utf8") },
      ),
      scriptIdentity: script ? fingerprint(path.resolve(script)) : undefined,
      config: config ? safeConfig(config) : undefined,
      rerunnable: config ? !!safeConfig(config) : false,
      startedAt: new Date(started).toISOString(),
      elapsedMs: 0,
      state: "starting",
      exitCode: null,
      k6Version: version,
      metrics: {},
      series: [],
      thresholds: [],
      summarySource: "observed",
      logs: [],
    };
    this.active = run;
    this.cancelled = false;
    onUpdate({ ...run });
    let directory: string | undefined;
    try {
      directory = await mkdtemp(path.join(tmpdir(), "loaddeck-"));
      await chmod(directory, 0o700);
      const metricsFile = path.join(directory, "points.json");
      const summaryFile = path.join(directory, "summary.json");
      const scriptFile = script ?? path.join(directory, "test.js");
      if (config)
        await writeFile(scriptFile, generateScript(config), { mode: 0o600 });
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        K6_NO_USAGE_REPORT: "true",
        NO_COLOR: "1",
      };
      if (config) environment.LOADDECK_SUMMARY = summaryFile;
      const secrets = config
        ? Object.values(config.headers)
            .flatMap((value) =>
              /^\$\{[A-Z_][A-Z0-9_]*\}$/.test(value)
                ? [process.env[value.slice(2, -1)] ?? ""]
                : [],
            )
            .concat(config.body ? [config.body] : [])
        : [];
      const args = ["run", "--out", `json=${metricsFile}`, scriptFile];
      const collector = new Aggregator(started);
      const parser = new JsonLines();
      const decoder = new StringDecoder("utf8");
      let offset = 0;
      let reading = false;
      const poll = async () => {
        if (reading) return;
        reading = true;
        try {
          const file = await open(metricsFile, "r");
          try {
            const buffer = Buffer.alloc(256 * 1024);
            for (let i = 0; i < 16; i++) {
              const { bytesRead } = await file.read(
                buffer,
                0,
                buffer.length,
                offset,
              );
              if (!bytesRead) break;
              offset += bytesRead;
              parser.push(decoder.write(buffer.subarray(0, bytesRead)), (r) =>
                collector.add(r),
              );
            }
          } finally {
            await file.close();
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            log(`Metrics collector: ${(error as Error).message}`);
        } finally {
          reading = false;
        }
        run.elapsedMs = Date.now() - started;
        Object.assign(run, collector.snapshot(run.elapsedMs));
        onUpdate({ ...run });
      };
      const log = (chunk: string) => {
        run.logs.push(redactLog(chunk, secrets));
        if (run.logs.length > 200) run.logs.splice(0, run.logs.length - 200);
      };
      const child = spawn(binary, args, {
        cwd: script ? path.dirname(script) : directory,
        env: environment,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child = child;
      run.state = "running";
      if (this.cancelled) this.stop();
      onUpdate({ ...run });
      child.stdout?.on("data", (chunk: Buffer) => log(chunk.toString()));
      child.stderr?.on("data", (chunk: Buffer) => log(chunk.toString()));
      const timer = setInterval(() => void poll(), 1000);
      const result = await new Promise<{ code: number | null; error?: Error }>(
        (resolve) => {
          child.once("error", (error) => resolve({ code: null, error }));
          child.once("close", (code) => resolve({ code }));
        },
      );
      clearInterval(timer);
      while (reading) await new Promise((resolve) => setTimeout(resolve, 10));
      await poll();
      while (true) {
        let size = 0;
        try {
          const file = await open(metricsFile, "r");
          size = (await file.stat()).size;
          await file.close();
        } catch {
          break;
        }
        if (offset >= size) break;
        await poll();
      }
      if (result.error) log(result.error.message);
      if (config) {
        try {
          const summary = readSummary(
            JSON.parse(await readFile(summaryFile, "utf8")),
          );
          run.metrics = {
            ...run.metrics,
            ...Object.fromEntries(
              Object.entries(summary.metrics).filter(
                ([, v]) => v !== undefined,
              ),
            ),
          };
          run.thresholds = summary.thresholds;
          run.summarySource = "k6-summary";
        } catch {
          log(
            "Authoritative summary unavailable. Percentiles are unavailable; displayed aggregates are observed metrics.",
          );
        }
      }
      run.exitCode = result.code;
      run.state = this.cancelled
        ? "cancelled"
        : result.code === 99
          ? "threshold_failed"
          : result.code === 0
            ? "completed"
            : "execution_failed";
      if (parser.malformed)
        log(`${parser.malformed} malformed metric records were ignored.`);
    } catch (error) {
      run.state = this.cancelled ? "cancelled" : "execution_failed";
      run.logs.push(redactLog((error as Error).message));
    } finally {
      if (this.forceTimer) clearTimeout(this.forceTimer);
      this.child = undefined;
      run.endedAt = new Date().toISOString();
      run.elapsedMs = Date.now() - started;
      if (directory)
        await rm(directory, { recursive: true, force: true }).catch(
          () => undefined,
        );
      this.active = undefined;
      onUpdate({ ...run });
    }
    return run;
  }
  stop(): void {
    if (!this.active) return;
    this.cancelled = true;
    this.active.state = "stopping";
    const child = this.child;
    if (!child?.pid) return;
    const signal = (force: boolean) => {
      try {
        if (process.platform === "win32") {
          const args = ["/PID", String(child.pid), "/T"];
          if (force) args.push("/F");
          execFile("taskkill", args, { windowsHide: true }, () => undefined);
        } else process.kill(-child.pid!, force ? "SIGKILL" : "SIGINT");
      } catch {
        child.kill(force ? "SIGKILL" : "SIGINT");
      }
    };
    signal(false);
    this.forceTimer = setTimeout(() => signal(true), 3000);
    this.forceTimer.unref();
  }
}
