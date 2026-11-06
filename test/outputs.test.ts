import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { defaultTest } from "../src/model";
import { K6Runner } from "../src/runner";
import { supportedExternalOutputs, externalEnvironment } from "../src/outputs";

test("external output capability profile and endpoint validation", () => {
  assert.deepEqual(supportedExternalOutputs("k6 v0.40.0"), []);
  assert.ok(supportedExternalOutputs("k6 v2.3.0").includes("influxdb"));
  assert.throws(() =>
    externalEnvironment(
      {
        kind: "influxdb",
        endpoint: "http://user:secret@localhost/db",
        usernameVariable: "",
        passwordVariable: "",
        enabled: true,
      },
      () => undefined,
    ),
  );
});
test(
  "real external outputs retain internal metrics and expose unavailable backend",
  { skip: !process.env.LOADDECK_TEST_K6, timeout: 30000 },
  async () => {
    let writes = 0;
    const backend = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        if (request.url?.includes("write")) writes++;
        response.statusCode = 204;
        response.end();
      });
    });
    const target = createServer((_, response) => response.end("ok"));
    await new Promise<void>((resolve) =>
      backend.listen(0, "127.0.0.1", resolve),
    );
    await new Promise<void>((resolve) =>
      target.listen(0, "127.0.0.1", resolve),
    );
    const a = backend.address(),
      b = target.address();
    assert.ok(a && typeof a === "object" && b && typeof b === "object");
    try {
      for (const kind of ["influxdb", "experimental-prometheus-rw"] as const) {
        const run = await new K6Runner().run(
          process.env.LOADDECK_TEST_K6!,
          "k6 v2.3.0",
          () => undefined,
          {
            config: {
              ...defaultTest,
              url: `http://127.0.0.1:${b.port}/`,
              duration: "1s",
              sleep: 0.1,
              externalOutput: {
                kind,
                endpoint: `http://127.0.0.1:${a.port}/${kind === "influxdb" ? "loaddeck" : "api/v1/write"}`,
                usernameVariable: "",
                passwordVariable: "",
                enabled: true,
              },
            },
          },
        );
        assert.equal(run.state, "completed", run.logs.join("\n"));
        assert.ok(run.metrics.requests! > 0);
        assert.ok(run.series.length);
        assert.equal(run.outputs?.[0]?.state, "unverified");
      }
      assert.ok(writes > 0);
      await new Promise<void>((resolve) => backend.close(() => resolve()));
      const failed = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "k6 v2.3.0",
        () => undefined,
        {
          config: {
            ...defaultTest,
            url: `http://127.0.0.1:${b.port}/`,
            duration: "1s",
            sleep: 0.1,
            externalOutput: {
              kind: "influxdb",
              endpoint: `http://127.0.0.1:${a.port}/loaddeck`,
              usernameVariable: "",
              passwordVariable: "",
              enabled: true,
            },
          },
        },
      );
      assert.equal(failed.state, "execution_failed", failed.logs.join("\n"));
      assert.ok(failed.metrics.requests! > 0);
      assert.equal(failed.outputs?.[0]?.state, "failed");
    } finally {
      backend.closeAllConnections();
      backend.close();
      target.closeAllConnections();
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  },
);
