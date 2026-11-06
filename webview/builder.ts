import {
  builtinMetrics,
  thresholdAggregations,
  validAggregation,
  type MetricDefinition,
  type MetricType,
} from "../src/thresholds";
import type { QuickTest } from "../src/model";
import { defaultTest } from "../src/model";
import { requestConfig } from "../src/requests";
import { requestEditor } from "./request";
import type { ClientMessage } from "../src/model";
import {
  executors,
  checkKinds,
  defaultScenario,
  type Scenario,
  type CheckRule,
  type ThresholdRule,
} from "../src/workload";

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  return e;
}
function action(label: string, fn: () => void): HTMLButtonElement {
  const b = node("button", label);
  b.type = "button";
  b.className = "secondary";
  b.addEventListener("click", fn);
  return b;
}
function control(
  label: string,
  value: string | number | boolean,
  change: (value: string) => void,
  options?: string[],
): HTMLElement {
  const wrap = node("label");
  wrap.className = "field";
  wrap.append(node("span", label));
  const input = options ? node("select") : node("input");
  if (input instanceof HTMLSelectElement) {
    for (const option of options!) {
      const o = node("option", option);
      o.value = option;
      input.append(o);
    }
  } else {
    input.type =
      typeof value === "boolean"
        ? "checkbox"
        : typeof value === "number"
          ? "number"
          : "text";
    if (typeof value === "boolean") input.checked = value;
  }
  if (input instanceof HTMLInputElement && input.type === "number")
    input.step = "any";
  input.setAttribute("aria-label", label);
  input.value = String(value);
  input.addEventListener("change", () =>
    change(
      input instanceof HTMLInputElement && input.type === "checkbox"
        ? String(input.checked)
        : input.value,
    ),
  );
  wrap.append(input);
  return wrap;
}
function section(title: string, description: string): HTMLDetailsElement {
  const d = node("details");
  d.append(node("summary", title), node("p", description));
  return d;
}
export function workloadBuilder(
  config: QuickTest,
  catalog: MetricDefinition[] = [],
  requestOnly = false,
  post: (m: ClientMessage) => void = () => undefined,
): HTMLElement {
  const available = new Map(
    builtinMetrics.map((metric) => [metric.name, metric]),
  );
  for (const metric of catalog)
    if (!available.has(metric.name)) available.set(metric.name, metric);
  const root = node("div");
  function render(): void {
    const opened = new Set(
      [...root.querySelectorAll("details[open]")].map(
        (d) => d.querySelector("summary")?.textContent,
      ),
    );
    root.replaceChildren();
    const scenarios = section(
      "Scenarios & executors",
      "Closed models control VUs. Open arrival-rate models control iteration starts, which may differ from achieved requests/sec. No default sleep is inserted in arrival-rate iterations.",
    );
    const items = config.scenarios ?? [];
    items.forEach((scenario, index) => {
      const card = node("fieldset");
      card.append(node("legend", `Scenario ${index + 1}`));
      const grid = node("div");
      grid.className = "grid";
      const set = (key: keyof Scenario, value: unknown) => {
        Object.assign(scenario, { [key]: value });
      };
      grid.append(
        control("Enabled", scenario.enabled, (v) =>
          set("enabled", v === "true"),
        ),
        control("Name", scenario.name, (v) => set("name", v)),
        control("Target URL", scenario.url, (v) => set("url", v)),
        control(
          "Executor",
          scenario.executor,
          (v) => {
            set("executor", v);
            render();
          },
          [...executors],
        ),
        control("Start time", scenario.startTime, (v) => set("startTime", v)),
        control("Graceful stop", scenario.gracefulStop, (v) =>
          set("gracefulStop", v),
        ),
      );
      const numeric = (key: keyof Scenario, label: string, fallback: number) =>
        grid.append(
          control(label, Number(scenario[key] ?? fallback), (v) =>
            set(key, Number(v)),
          ),
        );
      const text = (key: keyof Scenario, label: string, fallback: string) =>
        grid.append(
          control(label, String(scenario[key] ?? fallback), (v) => set(key, v)),
        );
      if (
        scenario.executor === "constant-vus" ||
        scenario.executor.includes("iterations")
      )
        numeric("vus", "Virtual users", 1);
      if (scenario.executor.includes("iterations")) {
        numeric("iterations", "Iterations", 1);
        text("maxDuration", "Maximum duration", "10m");
      }
      if (
        scenario.executor === "constant-vus" ||
        scenario.executor === "constant-arrival-rate"
      )
        text("duration", "Duration", "10s");
      if (scenario.executor.includes("arrival-rate")) {
        text("timeUnit", "Rate time unit", "1s");
        numeric("preAllocatedVUs", "Preallocated VUs", 1);
        numeric("maxVUs", "Maximum VUs", 10);
        numeric(
          scenario.executor === "constant-arrival-rate" ? "rate" : "startRate",
          scenario.executor === "constant-arrival-rate"
            ? "Iteration starts per time unit"
            : "Starting rate",
          1,
        );
      }
      if (scenario.executor === "ramping-vus") {
        numeric("startVUs", "Starting VUs", 0);
        text("gracefulRampDown", "Graceful ramp down", "5s");
      }
      card.append(grid);
      if (scenario.executor.startsWith("ramping-")) {
        const stages = (scenario.stages ??= []);
        for (const [stageIndex, stage] of stages.entries()) {
          const row = node("div");
          row.className = "grid";
          row.append(
            control(
              "Stage duration",
              stage.duration,
              (v) => (stage.duration = v),
            ),
            control("Target", stage.target, (v) => (stage.target = Number(v))),
            action("Remove stage", () => {
              stages.splice(stageIndex, 1);
              render();
            }),
          );
          card.append(row);
        }
        card.append(
          action("Add stage", () => {
            stages.push({ duration: "10s", target: 1 });
            render();
          }),
        );
      }
      const tags = node("textarea");
      tags.value = JSON.stringify(scenario.tags);
      tags.setAttribute("aria-label", "Scenario tags as JSON");
      tags.addEventListener("change", () => {
        try {
          scenario.tags = JSON.parse(tags.value);
          tags.setCustomValidity("");
        } catch {
          tags.setCustomValidity(
            "Enter a JSON object of tag names and values.",
          );
        }
      });
      card.append(tags);
      const env = node("textarea");
      env.value = JSON.stringify(scenario.env ?? {}, null, 2);
      env.setAttribute("aria-label", "Scenario nonsecret environment as JSON");
      env.addEventListener("change", () => {
        try {
          scenario.env = JSON.parse(env.value);
          env.setCustomValidity("");
        } catch {
          env.setCustomValidity("Enter a JSON object of nonsecret variables.");
        }
      });
      card.append(env);
      if (scenario.request) {
        const request = section(
          "Independent request",
          "This scenario uses its own protocol, request, authentication, data and checks.",
        );
        request.append(
          requestEditor(scenario.request as QuickTest, (m) =>
            post(
              m.type === "chooseFile" ? { ...m, scenario: scenario.name } : m,
            ),
          ),
        );
        card.append(
          request,
          action("Use shared request", () => {
            delete scenario.request;
            render();
          }),
        );
      } else
        card.append(
          action("Customize scenario request", () => {
            scenario.request = { ...defaultTest, ...requestConfig(config) };
            render();
          }),
        );
      card.append(
        action("Remove scenario", () => {
          items.splice(index, 1);
          render();
        }),
      );
      const end =
        scenario.stages
          ?.map((s) => `${s.duration} → ${s.target}`)
          .join(" · ") ??
        `${scenario.duration ?? scenario.maxDuration ?? "iteration budget"}`;
      card.append(
        node(
          "p",
          `Planned schedule: starts at ${scenario.startTime}, ${scenario.executor}, ${end}. This is the requested workload, not measured throughput.`,
        ),
      );
      scenarios.append(card);
    });
    scenarios.append(
      action(items.length ? "Add Scenario" : "Use advanced scenarios", () => {
        const s = {
          ...defaultScenario(config),
          name: `scenario_${items.length + 1}`,
          iterations: 1,
          maxDuration: "10m",
          rate: 1,
          startRate: 0,
          timeUnit: "1s",
          preAllocatedVUs: 1,
          maxVUs: 10,
          startVUs: 0,
          stages: [{ duration: config.duration, target: config.vus }],
          gracefulRampDown: "5s",
        };
        config.scenarios ??= [];
        config.scenarios.push(s);
        render();
      }),
    );
    if (items.length)
      scenarios.append(
        action("Use preset workload", () => {
          delete config.scenarios;
          render();
        }),
      );
    if (!requestOnly) root.append(scenarios);
    const checks = section(
      "Checks",
      "Checks validate responses. They change the exit result only when a checks threshold is configured.",
    );
    const rules = (config.checks ??= []);
    for (const [index, rule] of rules.entries()) {
      const row = node("fieldset");
      row.append(node("legend", `Check ${index + 1}`));
      const grid = node("div");
      grid.className = "grid";
      grid.append(
        control("Enabled", rule.enabled, (v) => (rule.enabled = v === "true")),
        control("Name", rule.name, (v) => (rule.name = v)),
        control(
          "Condition",
          rule.kind,
          (v) => {
            rule.kind = v as CheckRule["kind"];
            render();
          },
          checkKinds(config.protocol?.kind ?? "http"),
        ),
        control("Expected value", rule.value, (v) => (rule.value = v)),
        control("Header or JSON path", rule.path, (v) => (rule.path = v)),
        action("Remove check", () => {
          rules.splice(index, 1);
          render();
        }),
      );
      if (["bodyRegex", "headerRegex", "messageRegex"].includes(rule.kind))
        grid.append(
          control("Regex flags", rule.flags ?? "", (v) => (rule.flags = v)),
        );
      grid.append(
        control("Check group", rule.group ?? "", (v) => (rule.group = v)),
        control(
          "Scenarios (comma separated; empty means all)",
          (rule.scenarios ?? []).join(", "),
          (v) =>
            (rule.scenarios = v
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)),
        ),
      );
      const tags = node("textarea");
      tags.value = JSON.stringify(rule.tags ?? {}, null, 2);
      tags.setAttribute("aria-label", "Check tags as JSON");
      tags.addEventListener("change", () => {
        try {
          rule.tags = JSON.parse(tags.value);
          tags.setCustomValidity("");
        } catch {
          tags.setCustomValidity(
            "Enter a JSON object of nonsecret string tags.",
          );
        }
      });
      row.append(grid, tags);
      const help: Partial<Record<CheckRule["kind"], string>> = {
        messageContains:
          "Every received text message is checked. If no message arrives before the session closes, this check fails.",
        messageRegex:
          "Every received text message is checked. If no message arrives before the session closes, this check fails. Flags: i, m, s, u.",
        statuses: "Comma-separated HTTP status codes, such as 200, 201, 204.",
        bodyRegex:
          "Regular expression over response text. Flags: i, m, s, u. Complex patterns can consume substantial CPU.",
        headerRegex:
          "Path names the response header; value is a regular expression.",
        bodyBytes:
          "Minimum UTF-8 encoded response text size in bytes, after decoding/decompression. This is not transferred network bytes.",
        bodyLength:
          "Minimum JavaScript string length in UTF-16 code units; this is not a byte count.",
        jsonEquals:
          "Use a dot-separated JSON path and a JSON value. Invalid JSON and absent paths fail the check.",
        headerEquals: "Header names are matched without case sensitivity.",
      };
      if (help[rule.kind]) row.append(node("p", help[rule.kind]));
      checks.append(row);
    }
    checks.append(
      action("Add check", () => {
        config.checks ??= [];
        config.checks.push({
          name: `check_${rules.length + 1}`,
          kind:
            config.protocol?.kind === "ws"
              ? "messageContains"
              : config.protocol?.kind === "grpc"
                ? "grpcStatus"
                : "status",
          value:
            config.protocol?.kind === "grpc"
              ? "0"
              : config.protocol?.kind === "ws"
                ? "hello"
                : "200",
          path: "",
          enabled: true,
        });
        render();
      }),
      action("Require check pass rate ≥ 99%", () => {
        config.thresholdRules ??= [];
        config.thresholdRules.push({
          metric: "checks",
          aggregation: "rate",
          operator: ">=",
          value: 0.99,
          scope: "",
          abortOnFail: false,
          delayAbortEval: "",
        });
        render();
      }),
    );
    root.append(checks);
    const thresholds = section(
      "Threshold rules",
      "Only aggregations supported by the metric type are offered. Rates use ratios; timing metrics use milliseconds. Starter rules are suggestions, not your SLA.",
    );
    const thresholdRules = (config.thresholdRules ??= []);
    for (const [index, rule] of thresholdRules.entries()) {
      const row = node("fieldset");
      row.append(node("legend", `Threshold ${index + 1}`));
      const grid = node("div");
      grid.className = "grid";
      const metric = available.get(rule.metric),
        type = metric?.type ?? rule.metricType ?? "trend";
      if (!metric || metric.source !== "builtin") rule.metricType = type;
      const aggregations = thresholdAggregations(type);
      if (
        !aggregations.includes(rule.aggregation) &&
        validAggregation(type, rule.aggregation)
      )
        aggregations.push(rule.aggregation);
      grid.append(
        control(
          "Metric",
          metric ? rule.metric : "Custom metric…",
          (value) => {
            rule.metric = value === "Custom metric…" ? "custom_metric" : value;
            rule.metricType = available.get(rule.metric)?.type ?? "trend";
            if (!validAggregation(rule.metricType, rule.aggregation))
              rule.aggregation = thresholdAggregations(rule.metricType)[0]!;
            render();
          },
          [...available.keys(), "Custom metric…"],
        ),
      );
      if (!metric) {
        grid.append(
          control("Custom metric name", rule.metric, (v) => (rule.metric = v)),
          control(
            "Custom metric type",
            type,
            (v) => {
              rule.metricType = v as MetricType;
              if (!validAggregation(rule.metricType, rule.aggregation))
                rule.aggregation = thresholdAggregations(rule.metricType)[0]!;
              render();
            },
            ["counter", "gauge", "rate", "trend"],
          ),
        );
        row.append(
          node(
            "p",
            "The test must emit this custom metric. Selecting its name does not create measurements. Preview/save the script to add custom measurement logic.",
          ),
        );
      } else
        row.append(
          node(
            "p",
            `${metric.name}: ${metric.type} · ${metric.source === "k6-json" ? "observed in k6 output" : "built-in k6 metric"}`,
          ),
        );
      grid.append(
        control(
          "Aggregation",
          rule.aggregation,
          (v) => {
            rule.aggregation = v;
            render();
          },
          aggregations,
        ),
      );
      if (type === "trend" && rule.aggregation.startsWith("p("))
        grid.append(
          control(
            "Percentile (0–100)",
            Number(rule.aggregation.slice(2, -1)),
            (v) => {
              rule.aggregation = `p(${v})`;
            },
          ),
        );
      grid.append(
        control(
          "Operator",
          rule.operator,
          (v) => (rule.operator = v as ThresholdRule["operator"]),
          ["<", "<=", ">", ">=", "==", "!="],
        ),
        control("Value", rule.value, (v) => (rule.value = Number(v))),
        control("Tag filter", rule.scope, (v) => (rule.scope = v)),
        control("Abort on failure", rule.abortOnFail, (v) => {
          rule.abortOnFail = v === "true";
          if (!rule.abortOnFail) rule.delayAbortEval = "";
          render();
        }),
      );
      if (rule.abortOnFail)
        grid.append(
          control(
            "Delay abort evaluation",
            rule.delayAbortEval,
            (v) => (rule.delayAbortEval = v),
          ),
        );
      grid.append(
        action("Remove threshold", () => {
          thresholdRules.splice(index, 1);
          render();
        }),
      );
      row.append(
        grid,
        node(
          "p",
          `Unit: ${type === "rate" ? "ratio, 0–1 (0.01 = 1%)" : rule.aggregation === "rate" ? "per second" : (metric?.unit ?? "the custom metric’s unit")}`,
        ),
        node(
          "p",
          `${rule.metric}${rule.scope ? `{${rule.scope}}` : ""}: ${rule.aggregation}${rule.operator}${rule.value}`,
        ),
      );
      thresholds.append(row);
    }
    thresholds.append(
      action("Add threshold", () => {
        thresholdRules.push({
          metric: "http_req_duration",
          aggregation: "p(95)",
          operator: "<",
          value: 500,
          scope: "",
          abortOnFail: false,
          delayAbortEval: "",
        });
        render();
      }),
    );
    if (!requestOnly) root.append(thresholds);
    for (const d of root.querySelectorAll("details"))
      if (opened.has(d.querySelector("summary")?.textContent)) d.open = true;
  }
  render();
  root.addEventListener("refreshBuilder", render);
  return root;
}
