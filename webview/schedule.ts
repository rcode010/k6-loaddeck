import type { QuickTest } from "../src/model";
import { defaultScenario } from "../src/workload";
import { scenarioLoad, workloadLoad } from "../src/load";
import { durationSeconds } from "../src/duration";

export function schedule(c: QuickTest): HTMLElement {
  const root = document.createElement("section");
  root.className = "card";
  root.setAttribute("aria-label", "Planned workload schedule");
  const title = document.createElement("h3");
  title.textContent = "Planned workload";
  root.append(title);
  const scenarios = (c.scenarios ?? [defaultScenario(c)]).filter(
    (s) => s.enabled,
  );
  const load = workloadLoad(c);
  const description = document.createElement("p");
  description.textContent = Number.isFinite(load.duration)
    ? `Up to ${load.peakVus} concurrent VUs, ${load.duration.toFixed(1)} seconds including graceful stop${load.peakRate ? `, up to ${load.peakRate.toFixed(1)} scheduled iteration starts/s` : ""}. Desired schedule; actual request throughput depends on responses. Iteration-limited durations are upper bounds.`
    : "Complete the workload settings to preview the schedule.";
  root.append(description);
  if (!Number.isFinite(load.duration) || !load.duration) return root;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 600 ${scenarios.length * 80 + 30}`);
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    "Requested scenario timelines in elapsed seconds; each row uses its own VU or iteration-rate scale.",
  );
  scenarios.forEach((s, index) => {
    const plan = scenarioLoad(s);
    const y = index * 80;
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", "0");
    text.setAttribute("y", String(y + 15));
    text.setAttribute("fill", "currentColor");
    text.textContent = `${s.name}: ${plan.start}s → ${plan.end}s${plan.finite ? " (maximum)" : ""} · ${s.executor}`;
    svg.append(text);
    const scale = Math.max(
      1,
      plan.arrival
        ? (plan.rate ?? 0) * durationSeconds(s.timeUnit ?? "1s")
        : plan.vus,
    );
    let elapsed = plan.start;
    const points = [
      [
        elapsed,
        s.executor === "ramping-vus"
          ? (s.startVUs ?? 0)
          : s.executor === "ramping-arrival-rate"
            ? (s.startRate ?? 0)
            : scale,
      ],
    ];
    if (s.executor.startsWith("ramping-"))
      for (const stage of s.stages ?? []) {
        elapsed += durationSeconds(stage.duration);
        points.push([elapsed, stage.target]);
      }
    else points.push([plan.end, scale]);
    const line = document.createElementNS(ns, "polyline");
    line.setAttribute(
      "points",
      points
        .map(
          ([x, v]) =>
            `${10 + (x! / load.duration) * 580},${y + 66 - (v! / scale) * 34}`,
        )
        .join(" "),
    );
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "2");
    if (plan.finite) line.setAttribute("stroke-dasharray", "5 4");
    svg.append(line);
  });
  root.append(svg);
  return root;
}
