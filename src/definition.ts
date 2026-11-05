import { configuredThresholds } from "./thresholds";
import { validateIntegrations } from "./integrations";
import { validateScenarios, validateChecks } from "./workload";
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
  if (
    !["http:", "https:", "ws:", "wss:", "grpc:", "grpcs:"].includes(
      url.protocol,
    ) ||
    !url.hostname
  )
    throw new Error("URL: only HTTP and HTTPS are supported.");
  for (const [key, val] of url.searchParams)
    if (
      /token|secret|password|api[-_]?key|authorization/i.test(key) &&
      !/^\$\{[A-Z_][A-Z0-9_]*\}$/.test(val)
    )
      throw new Error(
        "Sensitive URL query values must reference runtime variables, such as ${API_TOKEN}.",
      );
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
  if (!["text", "json", "form", "multipart"].includes(c.bodyMode))
    throw new Error("Body: select text or JSON.");
  if (
    ["GET", "HEAD"].includes(c.method) &&
    (c.body || c.bodyMode === "multipart")
  )
    throw new Error("Body: GET and HEAD tests cannot send a body.");
  if (["json", "form", "multipart"].includes(c.bodyMode) && c.body) {
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
  configuredThresholds(c);
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
  if (c.checks) {
    validateChecks(c.checks);
    const names = new Set(
      (c.scenarios ?? [{ name: "main", enabled: true }])
        .filter((s) => s.enabled)
        .map((s) => s.name),
    );
    for (const rule of c.checks.filter((rule) => rule.enabled))
      if (rule.scenarios?.some((name) => !names.has(name)))
        throw new Error(
          `Check ${rule.name}: choose enabled scenarios from this test.`,
        );
  }
  validateIntegrations(c);
  if (!c.protocol && !["http:", "https:"].includes(url.protocol))
    throw new Error("Choose the matching protocol in Advanced options.");
  return {
    ...c,
    url: c.url,
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
    config.upload ||
    config.dataset ||
    (config.authentication?.mode && config.authentication.mode !== "none") ||
    config.protocol ||
    config.outputs?.length ||
    config.externalOutput?.enabled ||
    config.scenarios?.some((s) => {
      const u = new URL(s.url || config.url);
      return Boolean(u.search || u.hash);
    }) ||
    Object.keys(config.headers).length
  )
    return undefined;
  return {
    ...config,
    name: config.name ? "Saved quick test" : "",
    url: safeTarget(config.url),
  };
}
export { generateScript } from "./generator";
