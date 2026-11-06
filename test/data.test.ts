import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { datasetRows, datasetPreview } from "../src/data";
import { defaultTest } from "../src/model";
import { defaultScenario } from "../src/workload";
import { K6Runner } from "../src/runner";
import type { Dataset } from "../src/integrations";

test("dataset overrides enforce types and schema previews omit row values", () => {
  const rows = datasetRows("id,active,secret\n42,true,private-value\n", {
    format: "csv",
    types: { id: "number", active: "boolean" },
  });
  assert.deepEqual(rows, [{ id: 42, active: true, secret: "private-value" }]);
  assert.ok(!JSON.stringify(datasetPreview(rows)).includes("private-value"));
  assert.throws(
    () =>
      datasetRows("id\nnot-number", { format: "csv", types: { id: "number" } }),
    /number/,
  );
  assert.throws(
    () =>
      datasetRows("active\nyes", {
        format: "csv",
        types: { active: "boolean" },
      }),
    /true or false/,
  );
  assert.throws(
    () =>
      datasetRows('[{"id":1}]', {
        format: "json",
        types: { missing: "string" },
      }),
    /missing column/,
  );
  const special = datasetRows('[{"__proto__":"42"}]', {
    format: "json",
    types: JSON.parse('{"__proto__":"number"}'),
  });
  assert.equal(
    Object.getOwnPropertyDescriptor(special[0], "__proto__")?.value,
    42,
  );
});

test(
  "real CSV type overrides and every dataset strategy enforce repeat/fail semantics",
  { skip: !process.env.LOADDECK_TEST_K6, timeout: 20000 },
  async () => {
    const received: { id: number; active: boolean }[] = [];
    const server = createServer((request, response) => {
      let text = "";
      request.on("data", (chunk) => (text += chunk));
      request.on("end", () => {
        received.push(JSON.parse(text));
        response.end("ok");
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const directory = await mkdtemp(
      path.join(tmpdir(), "loaddeck-data-types-"),
    );
    try {
      const file = path.join(directory, "rows.csv");
      await writeFile(file, "id,active\n1,true\n2,false\n");
      const base = {
        ...defaultTest,
        url: `http://127.0.0.1:${address.port}/`,
        method: "POST",
        bodyMode: "json" as const,
        body: '{"id":"{{id}}","active":"{{active}}"}',
        sleep: 0,
      };
      for (const strategy of [
        "round-robin",
        "random",
        "per-vu",
        "unique",
      ] as const)
        for (const exhaustion of ["repeat", "fail"] as const) {
          received.length = 0;
          const dataset: Dataset = {
            file,
            format: "csv",
            strategy,
            exhaustion,
            variables: {},
            types: { id: "number", active: "boolean" },
          };
          const config = {
            ...base,
            dataset,
            scenarios: [
              {
                ...defaultScenario(base),
                executor: "shared-iterations" as const,
                vus: 3,
                iterations: 6,
              },
            ],
          };
          const run = await new K6Runner().run(
            process.env.LOADDECK_TEST_K6!,
            "fixture",
            () => undefined,
            { config },
          );
          const aborts = exhaustion === "fail" && strategy !== "random";
          assert.equal(
            run.state,
            aborts ? "execution_failed" : "completed",
            `${strategy}/${exhaustion}: ${run.logs.join("\n")}`,
          );
          if (aborts)
            assert.ok(
              run.logs.some((line) => line.includes("Dataset exhausted")),
            );
          else assert.equal(received.length, 6);
          assert.ok(
            received.every(
              (row) =>
                typeof row.id === "number" && typeof row.active === "boolean",
            ),
          );
        }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
