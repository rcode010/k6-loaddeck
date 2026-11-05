import type { QuickTest } from "../src/model";
import {
  executors,
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
export function workloadBuilder(config: QuickTest): HTMLElement {
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
    root.append(scenarios);
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
          config.protocol?.kind === "ws"
            ? ["messageContains"]
            : config.protocol?.kind === "grpc"
              ? ["grpcStatus", "jsonEquals"]
              : [
                  "status",
                  "duration",
                  "bodyContains",
                  "bodyNonempty",
                  "jsonEquals",
                  "headerEquals",
                  "headerExists",
                  "bodyLength",
                ],
        ),
        control("Expected value", rule.value, (v) => (rule.value = v)),
        control("Header or JSON path", rule.path, (v) => (rule.path = v)),
        action("Remove check", () => {
          rules.splice(index, 1);
          render();
        }),
      );
      row.append(grid);
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
      "Rate values are ratios (0.01 = 1%). Duration values are milliseconds. Starter rules are suggestions, not your SLA.",
    );
    const thresholdRules = (config.thresholdRules ??= []);
    for (const [index, rule] of thresholdRules.entries()) {
      const row = node("fieldset");
      row.append(node("legend", `Threshold ${index + 1}`));
      const grid = node("div");
      grid.className = "grid";
      grid.append(
        control(
          "Metric",
          rule.metric,
          (v) => {
            rule.metric = v;
            render();
          },
          [
            "http_req_duration",
            "http_req_failed",
            "http_reqs",
            "checks",
            "iterations",
            "dropped_iterations",
            "vus",
            "vus_max",
          ],
        ),
        control(
          "Aggregation",
          rule.aggregation,
          (v) => (rule.aggregation = v),
          [
            "avg",
            "min",
            "max",
            "med",
            "p(90)",
            "p(95)",
            "p(99)",
            "rate",
            "count",
            "value",
          ],
        ),
        control(
          "Operator",
          rule.operator,
          (v) => (rule.operator = v as ThresholdRule["operator"]),
          ["<", "<=", ">", ">=", "==", "!="],
        ),
        control("Value", rule.value, (v) => (rule.value = Number(v))),
        control("Tag filter", rule.scope, (v) => (rule.scope = v)),
        control(
          "Abort on failure",
          rule.abortOnFail,
          (v) => (rule.abortOnFail = v === "true"),
        ),
        control(
          "Delay abort evaluation",
          rule.delayAbortEval,
          (v) => (rule.delayAbortEval = v),
        ),
        action("Remove threshold", () => {
          thresholdRules.splice(index, 1);
          render();
        }),
      );
      row.append(
        grid,
        node(
          "p",
          `${rule.metric}${rule.scope ? `{${rule.scope}}` : ""}: ${rule.aggregation}${rule.operator}${rule.value}`,
        ),
      );
      thresholds.append(row);
    }
    thresholds.append(
      action("Add threshold", () => {
        config.thresholdRules ??= [];
        config.thresholdRules.push({
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
    root.append(thresholds);
    for (const d of root.querySelectorAll("details"))
      if (opened.has(d.querySelector("summary")?.textContent)) d.open = true;
  }
  render();
  root.addEventListener("refreshBuilder", render);
  return root;
}
