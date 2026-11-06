import { outcomeText, thresholdText } from "./outcome";
import type { Run } from "./model";
const escape = (text: unknown): string =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function exportRun(run: Run, format: "json" | "csv" | "html"): string {
  const safe = { ...run, logs: [], config: undefined };
  const units = {
    avg: "ms",
    p95: "ms",
    p99: "ms",
    failureRate: "ratio",
    rps: "requests/second",
  };
  const unit = (key: string) => {
    if (Object.hasOwn(units, key)) return units[key as keyof typeof units];
    const [name, aggregation] = key.split(".");
    const definition = run.metricCatalog?.find(
      (metric) => metric.name === name,
    );
    return aggregation === "rate" && definition?.type === "counter"
      ? "per second"
      : (definition?.unit ?? "count");
  };
  const values = { ...run.metrics, ...run.protocolMetrics };
  const rows = Object.entries(values).filter(
    ([, v]) => typeof v === "number" && Number.isFinite(v),
  );
  if (format === "json")
    return JSON.stringify(
      {
        format: "loaddeck-result-v1",
        units: {
          ...units,
          ...Object.fromEntries(rows.map(([key]) => [key, unit(key)])),
        },
        run: safe,
      },
      null,
      2,
    );
  if (format === "csv")
    return (
      [
        "metric,value,unit,source",
        ...rows.map(([key, value]) =>
          [key, value, unit(key), run.summarySource].join(","),
        ),
      ].join("\n") + "\n"
    );
  return `<!DOCTYPE html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>LoadDeck performance report</title><style>body{font:16px/1.6 system-ui;margin:40px auto;max-width:1000px;padding:0 20px;color:#17212b;background:#fff}td,th{padding:10px 20px;text-align:left;border-bottom:1px solid #bbb}table{border-collapse:collapse;width:100%}svg{width:100%;height:auto}polyline{fill:none;stroke:#1964b4;stroke-width:2}</style><h1>${escape(run.name)}</h1><p>${escape(run.testKind)} · ${escape(run.target)} · ${escape(outcomeText(run))}</p><p>${escape(run.startedAt)} · ${escape(run.k6Version)} · ${(run.elapsedMs / 1000).toFixed(2)} seconds</p><table><tr><th>Metric</th><th>Value</th><th>Unit</th></tr>${rows.map(([key, value]) => `<tr><td>${escape(key)}</td><td>${escape(value)}</td><td>${escape(unit(key))}</td></tr>`).join("")}</table><h2>Average latency over elapsed time</h2>${
    run.series.some((b) => b.latencyCount)
      ? `<svg viewBox="0 0 800 200" role="img" aria-label="Average latency in milliseconds over elapsed seconds"><polyline points="${run.series
          .filter((b) => b.latencyCount)
          .map(
            (b) =>
              `${(b.elapsed / Math.max(...run.series.map((p) => p.elapsed), 1)) * 780 + 10},${180 - (b.latencySum / b.latencyCount / Math.max(...run.series.filter((p) => p.latencyCount).map((p) => p.latencySum / p.latencyCount), 0.001)) * 160}`,
          )
          .join(" ")}"/></svg>`
      : "<p>No latency samples available.</p>"
  }<p>Observation: ${escape(run.observation ?? "unavailable")}</p><h2>Thresholds</h2>${run.thresholds.map((t) => `<p>${escape(t.metric)} ${escape(t.expression)}: ${escape(thresholdText(t))}</p>`).join("") || "<p>No evaluated thresholds available.</p>"}<p>Provenance: ${escape(run.summarySource)}. Missing metrics are unavailable. This report does not establish statistical significance.</p></html>`;
}
