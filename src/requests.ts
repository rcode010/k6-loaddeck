import type { QuickTest, RequestConfig } from "./model";
import type { Scenario } from "./workload";

export function requestConfig(c: QuickTest): RequestConfig {
  return structuredClone({
    url: c.url,
    method: c.method,
    sleep: c.sleep,
    headers: c.headers,
    body: c.body,
    bodyMode: c.bodyMode,
    upload: c.upload,
    expectedStatus: c.expectedStatus,
    protocol: c.protocol,
    authentication: c.authentication,
    dataset: c.dataset,
    checks: c.checks,
  });
}
export function scenarioConfig(c: QuickTest, s: Scenario): QuickTest {
  return {
    ...c,
    ...(s.request ? requestConfig(s.request as QuickTest) : {}),
    url: s.request?.url || s.url || c.url,
    scenarios: undefined,
    thresholds: {},
    thresholdRules: [],
  };
}
export function activeRequests(c: QuickTest): QuickTest[] {
  return c.scenarios
    ? c.scenarios.filter((s) => s.enabled).map((s) => scenarioConfig(c, s))
    : [c];
}
