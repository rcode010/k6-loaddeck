import {
  metricDefinition,
  type MetricType,
  type MetricDefinition,
} from "./thresholds";
import type { Bucket, Metrics, CheckResult } from "./model";

export class JsonLines {
  private pending = "";
  malformed = 0;
  push(chunk: string, consume: (record: unknown) => void): void {
    this.pending += chunk;
    let index: number;
    while ((index = this.pending.indexOf("\n")) >= 0) {
      const line = this.pending.slice(0, index);
      this.pending = this.pending.slice(index + 1);
      if (!line.trim()) continue;
      try {
        consume(JSON.parse(line));
      } catch {
        this.malformed++;
      }
    }
    if (this.pending.length > 1024 * 1024) {
      this.pending = "";
      this.malformed++;
    }
  }
}
export class Aggregator {
  private requests = 0;
  private hasRequests = false;
  private metricTypes = new Map<string, MetricType>();
  private metricCatalog = new Map<string, MetricDefinition>();
  private protocolStats = new Map<string, { sum: number; count: number }>();
  private latencySum = 0;
  private latencyCount = 0;
  private failures = 0;
  private failureCount = 0;
  private checkResults = new Map<string, CheckResult>();
  private checksPassed = 0;
  private checksFailed = 0;
  private checkCount = 0;
  private vus?: number;
  private dropped?: number;
  private buckets = new Map<number, Bucket>();
  private bucketWidth = 1;
  private scopes = new Map<string, Aggregator>();
  private protocols: Record<string, number> = {};
  constructor(
    private startedAt: number,
    private scoped = false,
  ) {}
  add(record: unknown): void {
    if (!record || typeof record !== "object") return;
    const r = record as {
      type?: string;
      metric?: string;
      data?: {
        type?: string;
        contains?: string;
        value?: number;
        time?: string;
        tags?: Record<string, string>;
      };
    };
    if (r.type === "Metric" && r.metric && r.data?.type) {
      if (
        this.metricTypes.size < 1000 &&
        /^[_A-Za-z][_A-Za-z0-9]{0,199}$/.test(r.metric) &&
        ["counter", "gauge", "rate", "trend"].includes(r.data.type)
      ) {
        const type = r.data.type as MetricType;
        this.metricTypes.set(r.metric, type);
        const definition = metricDefinition(r.metric, type, r.data.contains);
        this.metricCatalog.set(r.metric, { ...definition, source: "k6-json" });
      }
      return;
    }
    if (
      r.type !== "Point" ||
      !r.metric ||
      !r.data ||
      !Number.isFinite(r.data.value)
    )
      return;
    const value = r.data.value!;
    const scenario = r.data.tags?.scenario;
    if (
      !this.scoped &&
      scenario &&
      (this.scopes.has(scenario) || this.scopes.size < 20)
    ) {
      const scoped =
        this.scopes.get(scenario) ?? new Aggregator(this.startedAt, true);
      this.scopes.set(scenario, scoped);
      scoped.add(record);
    }
    if (/^(ws_|grpc_)/.test(r.metric)) {
      const kind = this.metricTypes.get(r.metric);
      if (!this.protocolStats.has(r.metric) && this.protocolStats.size >= 200)
        return;
      const stats = this.protocolStats.get(r.metric) ?? { sum: 0, count: 0 };
      stats.sum += value;
      stats.count++;
      this.protocolStats.set(r.metric, stats);
      const key =
        kind === "counter"
          ? "count"
          : kind === "trend"
            ? "avg"
            : kind === "rate"
              ? "rate"
              : "value";
      this.protocols[`${r.metric}.${key}`] =
        kind === "counter"
          ? stats.sum
          : kind === "trend" || kind === "rate"
            ? stats.sum / stats.count
            : value;
    }
    if (r.metric === "http_reqs" && r.data.tags?.proto)
      this.protocols[`negotiated.${r.data.tags.proto}`] =
        (this.protocols[`negotiated.${r.data.tags.proto}`] ?? 0) + value;
    const timestamp = Date.parse(r.data.time ?? "");
    if (!Number.isFinite(timestamp)) return;
    const elapsed = Math.max(
      0,
      Math.floor((timestamp - this.startedAt) / 1000 / this.bucketWidth) *
        this.bucketWidth,
    );
    const b = this.buckets.get(elapsed) ?? {
      elapsed,
      requests: 0,
      latencySum: 0,
      latencyCount: 0,
      failures: 0,
      failureCount: 0,
    };
    switch (r.metric) {
      case "http_reqs":
        this.hasRequests = true;
        this.requests += value;
        b.requests += value;
        break;
      case "http_req_duration":
        this.latencySum += value;
        this.latencyCount++;
        b.latencySum += value;
        b.latencyCount++;
        break;
      case "http_req_failed":
        this.failures += value;
        this.failureCount++;
        b.failures += value;
        b.failureCount++;
        break;
      case "vus":
        this.vus = value;
        b.vus = value;
        break;
      case "checks":
        if (r.data.tags?.check) {
          const name = r.data.tags.check,
            group = r.data.tags.group,
            scenario = r.data.tags.scenario,
            request = r.data.tags.request;
          const key = JSON.stringify([name, group, scenario, request]);
          if (this.checkResults.has(key) || this.checkResults.size < 2000) {
            const result = this.checkResults.get(key) ?? {
              name,
              group,
              scenario,
              request,
              passes: 0,
              fails: 0,
              source: "observed" as const,
            };
            if (value) result.passes++;
            else result.fails++;
            this.checkResults.set(key, result);
          }
        }
        this.checkCount++;
        if (value) this.checksPassed++;
        else this.checksFailed++;
        break;
      case "dropped_iterations":
        this.dropped = (this.dropped ?? 0) + value;
        break;
      default:
        return;
    }
    this.buckets.set(elapsed, b);
    while (this.buckets.size > 600) this.compact();
  }
  private compact(): void {
    this.bucketWidth *= 2;
    const merged = new Map<number, Bucket>();
    for (const b of this.buckets.values()) {
      const elapsed =
        Math.floor(b.elapsed / this.bucketWidth) * this.bucketWidth;
      const old = merged.get(elapsed);
      merged.set(
        elapsed,
        old
          ? {
              elapsed,
              requests: old.requests + b.requests,
              latencySum: old.latencySum + b.latencySum,
              latencyCount: old.latencyCount + b.latencyCount,
              failures: old.failures + b.failures,
              failureCount: old.failureCount + b.failureCount,
              vus: b.vus ?? old.vus,
            }
          : { ...b, elapsed },
      );
    }
    this.buckets = merged;
  }
  snapshot(elapsedMs: number): {
    metrics: Metrics;
    metricCatalog: MetricDefinition[];
    checkResults: CheckResult[];
    series: Bucket[];
    scenarioMetrics: Record<string, Metrics>;
    protocolMetrics: Record<string, number>;
  } {
    return {
      metricCatalog: [...this.metricCatalog.values()],
      checkResults: [...this.checkResults.values()].map((result) => ({
        ...result,
      })),
      scenarioMetrics: Object.fromEntries(
        [...this.scopes].map(([name, collector]) => [
          name,
          collector.snapshot(elapsedMs).metrics,
        ]),
      ),
      protocolMetrics: { ...this.protocols },
      metrics: {
        requests: this.hasRequests ? this.requests : undefined,
        rps: this.hasRequests
          ? this.requests / Math.max(elapsedMs / 1000, 0.001)
          : undefined,
        avg: this.latencyCount
          ? this.latencySum / this.latencyCount
          : undefined,
        failureRate: this.failureCount
          ? this.failures / this.failureCount
          : undefined,
        vus: this.vus,
        checksPassed: this.checkCount ? this.checksPassed : undefined,
        checksFailed: this.checkCount ? this.checksFailed : undefined,
        droppedIterations: this.dropped,
      },
      series: [...this.buckets.values()].sort((a, b) => a.elapsed - b.elapsed),
    };
  }
}
export { readSummary } from "./summary";
