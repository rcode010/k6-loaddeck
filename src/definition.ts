import {
  validateScenarios,
  validateChecks,
  compileThresholds,
  defaultScenario,
  scenarioOptions,
  checkExpression,
} from "./workload";
import { createHash } from "node:crypto";
import type { QuickTest } from "./model";

export { durationSeconds } from "./duration";
import { durationSeconds } from "./duration";
export function validateQuickTest(value: unknown): QuickTest {
  if (!value || typeof value !== "object")
    throw new Error("Invalid test configuration.");
  const c = value as QuickTest;
  if (typeof c.url !== "string" || c.url.length > 8192)
    throw new Error("URL: enter an HTTP or HTTPS URL.");
  let url: URL;
  try {
    url = new URL(c.url);
  } catch {
    throw new Error("URL: enter a valid absolute URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname)
    throw new Error("URL: only HTTP and HTTPS are supported.");
  if (url.username || url.password)
    throw new Error(
      "URL: use environment-backed authentication rather than embedded credentials.",
    );
  if (
    !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
      c.method,
    )
  )
    throw new Error("Method: select a supported HTTP method.");
  if (!["smoke", "load", "stress", "spike", "soak"].includes(c.testKind))
    throw new Error("Preset: select a supported test kind.");
  if (!Number.isInteger(c.vus) || c.vus < 1 || c.vus > 10000)
    throw new Error("Virtual users: enter an integer from 1 to 10000.");
  const duration =
    typeof c.duration === "string" ? durationSeconds(c.duration) : NaN;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400)
    throw new Error(
      "Duration: use a positive duration up to 24 hours, such as 10s or 5m.",
    );
  if (!Number.isFinite(c.sleep) || c.sleep < 0 || c.sleep > 3600)
    throw new Error("Think time: enter 0–3600 seconds.");
  if (typeof c.name !== "string" || c.name.length > 160)
    throw new Error("Name: use at most 160 characters.");
  if (typeof c.body !== "string" || c.body.length > 1024 * 1024)
    throw new Error("Body: maximum size is 1 MiB.");
  if (!["text", "json"].includes(c.bodyMode))
    throw new Error("Body: select text or JSON.");
  if (["GET", "HEAD"].includes(c.method) && c.body)
    throw new Error("Body: GET and HEAD tests cannot send a body.");
  if (c.bodyMode === "json" && c.body) {
    try {
      JSON.parse(c.body);
    } catch {
      throw new Error("Body: enter valid JSON.");
    }
  }
  if (
    !c.headers ||
    typeof c.headers !== "object" ||
    Array.isArray(c.headers) ||
    Object.keys(c.headers).length > 100
  )
    throw new Error("Headers: enter an object with at most 100 headers.");
  for (const [key, val] of Object.entries(c.headers)) {
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) ||
      typeof val !== "string" ||
      /[\r\n]/.test(val)
    )
      throw new Error("Headers: invalid name or value.");
    if (
      /authorization|cookie|api[-_]?key|token|secret/i.test(key) &&
      !/^\$\{[A-Z_][A-Z0-9_]*\}$/.test(val)
    )
      throw new Error(
        "Sensitive headers must reference an environment variable, for example ${API_TOKEN}.",
      );
  }
  if (
    c.expectedStatus !== undefined &&
    (!Number.isInteger(c.expectedStatus) ||
      c.expectedStatus < 100 ||
      c.expectedStatus > 599)
  )
    throw new Error("Expected status: enter 100–599.");
  if (
    !c.thresholds ||
    typeof c.thresholds !== "object" ||
    Array.isArray(c.thresholds)
  )
    throw new Error("Thresholds: enter a metric-to-expressions object.");
  const allowed: Record<string, string[]> = {
    http_req_duration: ["avg", "min", "max", "med", "p(90)", "p(95)", "p(99)"],
    http_req_failed: ["rate"],
    checks: ["rate"],
    http_reqs: ["count", "rate"],
    iterations: ["count", "rate"],
    dropped_iterations: ["count", "rate"],
  };
  for (const [metric, expressions] of Object.entries(c.thresholds)) {
    if (
      !allowed[metric] ||
      !Array.isArray(expressions) ||
      expressions.length > 20 ||
      !expressions.length
    )
      throw new Error(
        "Thresholds: select a supported metric and nonempty expressions.",
      );
    for (const expression of expressions) {
      const match =
        typeof expression === "string" &&
        /^(avg|min|max|med|p\(\d+\)|rate|count)\s*(<=|>=|<|>|==|!=)\s*(\d+(?:\.\d+)?)$/.exec(
          expression,
        );
      if (!match || !allowed[metric]!.includes(match[1]!))
        throw new Error(`Thresholds: invalid expression for ${metric}.`);
    }
  }
  if (c.scenarios) {
    validateScenarios(c.scenarios);
    for (const scenario of c.scenarios) {
      const target = new URL(scenario.url || c.url);
      if (
        !["http:", "https:"].includes(target.protocol) ||
        target.username ||
        target.password
      )
        throw new Error(
          "Scenario target must be an HTTP URL without embedded credentials.",
        );
    }
  }
  if (c.checks) validateChecks(c.checks);
  if (c.thresholdRules) compileThresholds(c.thresholdRules);
  return {
    ...c,
    url: url.toString(),
    headers: { ...c.headers },
    thresholds: { ...c.thresholds },
  };
}
export function safeTarget(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "Custom script";
  }
}
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function safeConfig(config: QuickTest): QuickTest | undefined {
  const url = new URL(config.url);
  if (
    url.search ||
    url.hash ||
    config.body ||
    Object.keys(config.headers).length
  )
    return undefined;
  return {
    ...config,
    name: config.name ? "Saved quick test" : "",
    url: safeTarget(config.url),
  };
}
export function generateScript(c: QuickTest): string {
  const scenarios = (c.scenarios ?? [defaultScenario(c)]).filter(
    (s) => s.enabled,
  );
  const thresholds = {
    ...c.thresholds,
    ...compileThresholds(c.thresholdRules ?? []),
  };
  const options = {
    scenarios: Object.fromEntries(
      scenarios.map((s, i) => [s.name, scenarioOptions(s, i)]),
    ),
    thresholds,
    summaryTrendStats: ["avg", "min", "max", "med", "p(95)", "p(99)"],
    systemTags: [
      "status",
      "method",
      "name",
      "scenario",
      "expected_response",
      "proto",
    ],
  };
  const headers = Object.entries(c.headers)
    .map(
      ([key, val]) =>
        `${JSON.stringify(key)}: ${/^\$\{[A-Z_][A-Z0-9_]*\}$/.test(val) ? `__ENV[${JSON.stringify(val.slice(2, -1))}]` : JSON.stringify(val)}`,
    )
    .join(", ");
  const checks = (c.checks ?? [])
    .filter((r) => r.enabled)
    .map(
      (rule) =>
        `${JSON.stringify(rule.name)}: r => safeCheck(() => ${checkExpression(rule, "http")})`,
    );
  if (c.expectedStatus !== undefined)
    checks.push(
      `${JSON.stringify(`status is ${c.expectedStatus}`)}: r => r.status === ${c.expectedStatus}`,
    );
  return `import http from 'k6/http';\nimport { check, sleep } from 'k6';\n\nexport const options = ${JSON.stringify(options, null, 2)};\n\nfunction safeCheck(fn) { try { return Boolean(fn()); } catch { return false; } }\nfunction jsonPath(value, path) { return path.split('.').reduce((v, key) => v == null ? undefined : v[key], value); }\n\n${scenarios.map((s, i) => `export function scenario_${i}() {\n  const response = http.request(${JSON.stringify(c.method)}, ${JSON.stringify(s.url || c.url)}, ${c.body ? JSON.stringify(c.body) : "null"}, { headers: { ${headers} }, tags: { name: ${JSON.stringify(s.name)} }, timeout: '30s' });\n${checks.length ? `  check(response, { ${checks.join(", ")} });\n` : ""}${s.executor.includes("arrival-rate") ? "" : `  sleep(${c.sleep});\n`}}`).join("\n\n")}\n\nexport default scenario_0;\n\nexport function handleSummary(data) {\n  return __ENV.LOADDECK_SUMMARY ? { [__ENV.LOADDECK_SUMMARY]: JSON.stringify(data) } : { stdout: JSON.stringify(data, null, 2) };\n}\n`;
}
