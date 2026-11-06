import { configuredThresholds, reconcileThresholds } from "./thresholds";
import { observation, plannedDurationMs } from "./observation";
import { LogBuffer } from "./logs";
import { externalEnvironment, supportedExternalOutputs } from "./outputs";
import { credentialVariables } from "./integrations";
import { datasetRows } from "./data";
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
import { activeRequests } from "./requests";
import { protoMethods } from "./proto";

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
    return {
      ready: true,
      version,
      externalOutputs: supportedExternalOutputs(version),
    };
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
    .replace(/https?:\/\/[^\s"'<>]+/gi, (match) => safeTarget(match));
  for (const secret of secrets
    .flatMap((value) => [
      value,
      ...value.split(/\r?\n/).filter((part) => part.length > 4),
    ])
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
  private disposed = false;
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
    input:
      | { config: QuickTest; environment?: Record<string, string> }
      | { script: string; environment?: Record<string, string> },
  ): Promise<Run> {
    if (this.disposed) throw new Error("The k6 runner has been disposed.");
    if (this.busy)
      throw new Error(
        "A test is already running. Stop it before starting another.",
      );
    const config = "config" in input ? input.config : undefined;
    const script = "script" in input ? input.script : undefined;
    const requests = config ? activeRequests(config) : [];
    const protocols = [
      ...new Set(requests.map((r) => r.protocol?.kind ?? "http")),
    ];
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
          ? {
              ...config,
              name: undefined,
              outputs: undefined,
              externalOutput: undefined,
            }
          : { script, content: await readFile(script!, "utf8") },
      ),
      conditions: config
        ? {
            target: safeTarget(config.url),
            method: config.method,
            protocol: config.protocol?.kind ?? "http",
            workload: JSON.stringify(
              config.scenarios
                ?.filter((s) => s.enabled)
                .map((s) => ({
                  name: s.name,
                  executor: s.executor,
                  vus: s.vus,
                  duration: s.duration,
                  stages: s.stages,
                  startTime: s.startTime,
                  rate: s.rate,
                  iterations: s.iterations,
                  preAllocatedVUs: s.preAllocatedVUs,
                  maxVUs: s.maxVUs,
                })) ?? {
                kind: config.testKind,
                vus: config.vus,
                duration: config.duration,
                sleep: config.sleep,
              },
            ),
            authentication: config.authentication?.mode ?? "none",
            data: config.dataset
              ? `${config.dataset.format}; ${config.dataset.strategy}; ${config.dataset.exhaustion}`
              : "none",
            thresholds: JSON.stringify({
              base: config.thresholds,
              rules: config.thresholdRules?.map((r) => ({
                metric: r.metric,
                aggregation: r.aggregation,
                operator: r.operator,
                value: r.value,
                abortOnFail: r.abortOnFail,
              })),
            }),
          }
        : undefined,
      scriptIdentity: script ? fingerprint(path.resolve(script)) : undefined,
      config: config ? safeConfig(config) : undefined,
      rerunnable: config ? !!safeConfig(config) : false,
      startedAt: new Date(started).toISOString(),
      elapsedMs: 0,
      state: "starting",
      exitCode: null,
      k6Version: version,
      protocol: config
        ? protocols.length === 1
          ? protocols[0]
          : "mixed"
        : "custom",
      scenarioProtocols: config?.scenarios
        ? Object.fromEntries(
            config.scenarios
              .filter((s) => s.enabled)
              .map((s, i) => [s.name, requests[i]!.protocol?.kind ?? "http"]),
          )
        : undefined,
      thresholdsConfigured: config
        ? configuredThresholds(config).length > 0
        : undefined,
      plannedDurationMs: config ? plannedDurationMs(config) : undefined,
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
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        ...("environment" in input ? input.environment : {}),
        K6_NO_USAGE_REPORT: "true",
        NO_COLOR: "1",
      };
      if (config) {
        for (const name of Object.keys(environment))
          if (name.startsWith("K6_")) delete environment[name];
        environment.K6_NO_USAGE_REPORT = "true";
        environment.LOADDECK_SUMMARY = summaryFile;
      }
      if (config?.externalOutput?.enabled) {
        if (
          !supportedExternalOutputs(version).includes(
            config.externalOutput.kind,
          )
        )
          throw new Error(
            "External outputs are only validated for k6 v2.3.x in this preview.",
          );
        Object.assign(
          environment,
          externalEnvironment(
            config.externalOutput,
            (name) => environment[name],
          ),
        );
      }
      const secrets = config
        ? credentialVariables(config)
            .map((name) => environment[name] ?? "")
            .concat(requests.flatMap((r) => (r.body ? [r.body] : [])))
        : Object.values(
            "environment" in input ? (input.environment ?? {}) : {},
          );
      if (config) {
        for (const name of credentialVariables(config))
          if (!environment[name])
            throw new Error(`Missing credential variable: ${name}`);
        for (const request of requests) {
          if (request.protocol?.kind === "grpc") {
            const methods = await protoMethods(
              request.protocol.protoFile,
              request.protocol.importPaths,
            );
            if (
              !methods.includes(request.protocol.grpcMethod.replace(/^\//, ""))
            )
              throw new Error(
                "Choose a unary service/method declared by the selected gRPC schema.",
              );
          }
          if (request.upload) {
            const info = await open(request.upload.path, "r");
            try {
              if ((await info.stat()).size > 20 * 1024 * 1024)
                throw new Error("Upload exceeds the 20 MiB limit.");
            } finally {
              await info.close();
            }
          }
          if (request.dataset?.file) {
            const file = await open(request.dataset.file, "r");
            try {
              if ((await file.stat()).size > 20 * 1024 * 1024)
                throw new Error("Dataset exceeds the 20 MiB limit.");
            } finally {
              await file.close();
            }
            const text = await readFile(request.dataset.file, "utf8");
            datasetRows(text, request.dataset);
          }
        }
      }
      const args = ["run"];
      if (config) {
        const certificateNames = requests.flatMap((r) =>
          r.authentication?.mode === "mtls"
            ? [
                r.authentication.certificateVariable,
                r.authentication.privateKeyVariable,
              ]
            : [],
        );
        const secretNames = /^k6 v?2\.3\./i.test(version)
          ? credentialVariables(config).filter((name) => {
              const value = environment[name];
              return (
                value &&
                value === value.trim() &&
                !/[\r\n\0]/.test(value) &&
                !certificateNames.includes(name)
              );
            })
          : [];
        if (secretNames.length) {
          const secretFile = path.join(directory, "secrets.txt");
          await writeFile(
            secretFile,
            secretNames
              .map((name) => `${name}=${environment[name]}`)
              .join("\n"),
            { mode: 0o600 },
          );
          args.push("--secret-source", `file=${secretFile}`);
          for (const name of secretNames) delete environment[name];
        }
        run.credentialSource = secretNames.length
          ? "k6-secret-source"
          : "environment";
        await writeFile(scriptFile, generateScript(config, secretNames), {
          mode: 0o600,
        });
        const configFile = path.join(directory, "config.json");
        await writeFile(configFile, "{}", { mode: 0o600 });
        args.push("--config", configFile);
      }
      args.push("--out", `json=${metricsFile}`);
      for (const output of config?.outputs ?? []) {
        if (!path.isAbsolute(output.path))
          throw new Error("Output paths must be absolute.");
        const file = await open(output.path, "wx", 0o600);
        await file.close();
        args.push("--out", `${output.format}=${output.path}`);
      }
      if (config?.externalOutput?.enabled)
        args.push(
          "--out",
          config.externalOutput.kind === "influxdb"
            ? `influxdb=${config.externalOutput.endpoint}`
            : config.externalOutput.kind,
        );
      args.push(scriptFile);
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
            if ((await file.stat()).size > 256 * 1024 * 1024) {
              log(
                "Internal metric stream exceeded 256 MiB; stopping to protect disk space.",
              );
              this.stop();
            }
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
      let outputError = false;
      let logBytes = 0;
      const log = (chunk: string) => {
        if (
          config?.externalOutput?.enabled &&
          /level=error|connection refused|couldn.t flush/i.test(chunk)
        )
          outputError = true;
        const value = redactLog(chunk, secrets);
        run.logs.push(value);
        logBytes += Buffer.byteLength(value, "utf8");
        while (run.logs.length > 200 || logBytes > 65536) {
          const removed = run.logs.shift();
          if (removed !== undefined)
            logBytes -= Buffer.byteLength(removed, "utf8");
        }
      };
      if (this.disposed) throw new Error("Extension is shutting down.");
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
      const stdoutLogs = new LogBuffer(log),
        stderrLogs = new LogBuffer(log);
      child.stdout?.on("data", (chunk: Buffer) => stdoutLogs.write(chunk));
      child.stderr?.on("data", (chunk: Buffer) => stderrLogs.write(chunk));
      const timer = setInterval(() => void poll(), 1000);
      const result = await new Promise<{ code: number | null; error?: Error }>(
        (resolve) => {
          child.once("error", (error) => resolve({ code: null, error }));
          child.once("close", (code) => resolve({ code }));
        },
      );
      clearInterval(timer);
      stdoutLogs.end();
      stderrLogs.end();
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
          run.thresholds = reconcileThresholds(config, summary.thresholds);
          if (!run.checkResults?.length)
            run.checkResults = summary.checkResults;
          run.protocolMetrics = {
            ...run.protocolMetrics,
            ...summary.protocolMetrics,
          };
          run.metricCatalog = summary.metricCatalog.length
            ? summary.metricCatalog
            : run.metricCatalog;
          run.engineElapsedMs = summary.engineElapsedMs;
          run.summarySource = "k6-summary";
        } catch {
          log(
            "Authoritative summary unavailable. Percentiles are unavailable; displayed aggregates are observed metrics.",
          );
        }
      }
      if (config && run.summarySource !== "k6-summary")
        run.thresholds = reconcileThresholds(config, []);
      run.exitCode = result.code;
      if (outputError)
        log(
          "External output reported an error. Metrics delivery was not verified.",
        );
      run.state = this.cancelled
        ? "cancelled"
        : result.code === 99
          ? "threshold_failed"
          : result.code === 0 && !outputError
            ? "completed"
            : "execution_failed";
      if (parser.malformed)
        log(`${parser.malformed} malformed metric records were ignored.`);
    } catch (error) {
      run.state = this.cancelled ? "cancelled" : "execution_failed";
      run.logs.push(redactLog((error as Error).message));
    } finally {
      if (this.forceTimer) clearTimeout(this.forceTimer);
      this.forceTimer = undefined;
      this.child = undefined;
      run.observation = observation(run, config);
      if (config && !run.thresholds.length)
        run.thresholds = reconcileThresholds(config, []);
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
  dispose(): void {
    this.disposed = true;
    this.stop();
  }
  stop(): void {
    if (!this.active || this.forceTimer) return;
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
