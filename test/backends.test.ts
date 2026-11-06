import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { K6Runner, discover } from "../src/runner";
import { defaultTest } from "../src/model";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
  await closed;
  clearTimeout(timer);
}
test(
  "real InfluxDB and Prometheus persist k6 metrics alongside internal and native outputs",
  {
    skip:
      !process.env.LOADDECK_TEST_K6 ||
      !process.env.LOADDECK_TEST_INFLUXDB ||
      !process.env.LOADDECK_TEST_PROMETHEUS,
    timeout: 30000,
  },
  async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "loaddeck-backends-fixture-"),
    );
    const target = createServer((_, response) => response.end("ok"));
    await new Promise<void>((resolve) =>
      target.listen(0, "127.0.0.1", resolve),
    );
    const address = target.address();
    assert.ok(address && typeof address === "object");
    const children: ChildProcess[] = [];
    let logs = "";
    const start = (binary: string, args: string[]) => {
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !key.startsWith("INFLUXDB_"),
        ),
      );
      const child = spawn(binary, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      child.on("error", (error) => {
        logs = error.message;
      });
      for (const stream of [child.stdout, child.stderr])
        stream!.on(
          "data",
          (chunk) => (logs = (logs + chunk.toString()).slice(-12000)),
        );
      children.push(child);
      return child;
    };
    const ready = async (url: string, child: ChildProcess) => {
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null) throw new Error(logs);
        try {
          if ((await fetch(url)).ok) return;
        } catch (error) {
          logs = (logs + String(error)).slice(-12000);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Backend did not become ready: ${logs}`);
    };
    try {
      const influxPort = await availablePort(),
        rpcPort = await availablePort(),
        prometheusPort = await availablePort();
      const influxConfig = path.join(directory, "influx.conf"),
        prometheusConfig = path.join(directory, "prometheus.yml");
      await writeFile(
        influxConfig,
        `reporting-disabled = true\nbind-address = "127.0.0.1:${rpcPort}"\n[meta]\ndir = ${JSON.stringify(path.join(directory, "influx-meta"))}\n[data]\ndir = ${JSON.stringify(path.join(directory, "influx-data"))}\nwal-dir = ${JSON.stringify(path.join(directory, "influx-wal"))}\n[http]\nbind-address = "127.0.0.1:${influxPort}"\nauth-enabled = false\nlog-enabled = false\n[monitor]\nstore-enabled = false\n`,
      );
      await writeFile(
        prometheusConfig,
        "global:\n  scrape_interval: 15s\nscrape_configs: []\n",
      );
      const influx = start(process.env.LOADDECK_TEST_INFLUXDB!, [
        "-config",
        influxConfig,
      ]);
      const prometheus = start(process.env.LOADDECK_TEST_PROMETHEUS!, [
        "--config.file=" + prometheusConfig,
        "--storage.tsdb.path=" + path.join(directory, "prometheus-data"),
        `--web.listen-address=127.0.0.1:${prometheusPort}`,
        "--web.enable-remote-write-receiver",
        "--storage.tsdb.retention.time=1h",
      ]);
      await Promise.all([
        ready(`http://127.0.0.1:${influxPort}/ping`, influx),
        ready(`http://127.0.0.1:${prometheusPort}/-/ready`, prometheus),
      ]);
      const installation = await discover(process.env.LOADDECK_TEST_K6!);
      for (const kind of ["influxdb", "experimental-prometheus-rw"] as const) {
        const native = path.join(directory, `${kind}.json`);
        const run = await new K6Runner().run(
          process.env.LOADDECK_TEST_K6!,
          installation.version,
          () => undefined,
          {
            config: {
              ...defaultTest,
              url: `http://127.0.0.1:${address.port}/`,
              duration: "2s",
              sleep: 0.1,
              outputs: [{ format: "json", path: native }],
              externalOutput: {
                enabled: true,
                kind,
                endpoint:
                  kind === "influxdb"
                    ? `http://127.0.0.1:${influxPort}/loaddeck`
                    : `http://127.0.0.1:${prometheusPort}/api/v1/write`,
                usernameVariable: "",
                passwordVariable: "",
              },
            },
          },
        );
        assert.equal(run.state, "completed", run.logs.join("\n"));
        assert.ok((run.metrics.requests ?? 0) > 0);
        assert.ok(run.series.length);
        assert.ok((await readFile(native, "utf8")).includes('"http_reqs"'));
        assert.equal(run.outputs?.[0]?.state, "written");
        if (kind === "influxdb") {
          const query = new URL(`http://127.0.0.1:${influxPort}/query`);
          query.searchParams.set("db", "loaddeck");
          query.searchParams.set("q", 'SELECT sum("value") FROM "http_reqs"');
          const response = await fetch(query);
          const data = (await response.json()) as {
            results: { series?: { values: [string, number][] }[] }[];
          };
          assert.ok(
            (data.results[0]?.series?.[0]?.values?.[0]?.[1] ?? 0) > 0,
            JSON.stringify(data),
          );
        } else {
          const response = await fetch(
            `http://127.0.0.1:${prometheusPort}/api/v1/query?query=k6_http_reqs_total`,
          );
          const data = (await response.json()) as {
            data: { result: { value: [number, string] }[] };
          };
          assert.ok(
            data.data.result.some((series) => Number(series.value[1]) > 0),
            JSON.stringify(data),
          );
        }
      }
    } finally {
      await Promise.all(children.map(stop));
      target.closeAllConnections();
      await new Promise<void>((resolve) => target.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
