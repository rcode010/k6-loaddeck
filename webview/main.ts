import {
  seriesPoints,
  sharedChartScale,
  type ChartMetric,
  type ChartScale,
} from "../src/series";
import { outcomeText, thresholdText } from "../src/outcome";
import { integrationBuilder } from "./integrations";
import { workloadBuilder } from "./builder";
import { compareRuns, commonScenarios, scopedRun } from "../src/comparison";
import {
  defaultTest,
  type QuickTest,
  type Run,
  type Screen,
  type ViewState,
  type ClientMessage,
  type Metrics,
} from "../src/model";
declare function acquireVsCodeApi(): {
  postMessage(message: ClientMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};
const api = acquireVsCodeApi();
const root = document.querySelector<HTMLDivElement>("#app")!;
let state: ViewState | undefined;
let draft: QuickTest = { ...defaultTest };
let selected: string[] = [];
let search = "";
let kind = "";
let outcome = "";
let sort = "newest";
let fromDate = "";
let toDate = "";
let baseline = "";
let candidate = "";
let comparisonScenario = "";
let dashboardScenario = "";
let dashboardRunId = "";
let comparisonChart: ChartMetric = "latency";
let initial = true;
const post = (message: ClientMessage) => api.postMessage(message);
const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
};
function button(
  label: string,
  action: () => void,
  className = "secondary",
): HTMLButtonElement {
  const e = element("button", label, className);
  e.type = "button";
  e.addEventListener("click", action);
  return e;
}
function field(
  label: string,
  input: HTMLElement,
  hint?: string,
): HTMLLabelElement {
  const wrap = element("label", undefined, "field");
  input.setAttribute("aria-label", label);
  wrap.append(element("span", label), input);
  if (hint) wrap.append(element("small", hint));
  return wrap;
}
function input(value: string, type = "text"): HTMLInputElement {
  const e = element("input");
  e.type = type;
  e.value = value;
  return e;
}
function select(options: [string, string][], value: string): HTMLSelectElement {
  const e = element("select");
  for (const [key, label] of options) {
    const o = element("option", label);
    o.value = key;
    e.append(o);
  }
  e.value = value;
  return e;
}
function format(value: number | undefined, digits = 2): string {
  return value === undefined || !Number.isFinite(value)
    ? "N/A"
    : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}
function heading(title: string, subtitle: string): HTMLElement {
  const e = element("header", undefined, "page-heading");
  e.append(element("h1", title), element("p", subtitle));
  return e;
}
function notice(text: string): HTMLElement {
  const e = element("div", text, "notice");
  e.setAttribute("role", "status");
  return e;
}
const status = outcomeText;
function navigation(): HTMLElement {
  const e = element("nav", undefined, "navigation");
  e.setAttribute("aria-label", "LoadDeck navigation");
  e.append(element("strong", "LoadDeck", "brand"));
  for (const [screen, label] of [
    ["home", "New test"],
    ["run", "Dashboard"],
    ["history", "History"],
    ["compare", "Compare"],
    ["saved", "Saved tests"],
  ] as [Screen, string][]) {
    const b = button(
      label,
      () => post({ type: "navigate", screen }),
      "nav-button",
    );
    if (state?.screen === screen) {
      b.classList.add("active");
      b.setAttribute("aria-current", "page");
    }
    e.append(b);
  }
  return e;
}
function remember(): void {
  api.setState({
    draft: {
      ...defaultTest,
      testKind: draft.testKind,
      vus: draft.vus,
      duration: draft.duration,
    },
  });
}
function configForm(): HTMLElement {
  const form = element("form", undefined, "test-form");
  const url = input(draft.url, "url");
  url.required = true;
  url.type = "text";
  url.placeholder = "https://localhost:3000/api/health";
  url.autocomplete = "off";
  const method = select(
    ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((m) => [
      m,
      m,
    ]),
    draft.method,
  );
  const target = element("div", undefined, "target-row");
  target.append(field("Method", method), field("Target URL", url));
  const preset = select(
    [
      ["smoke", "Smoke · quick sanity check"],
      ["load", "Load · steady traffic"],
      ["stress", "Stress · staged ramp to twice the VUs"],
      ["spike", "Spike · abrupt increase and recovery"],
      ["soak", "Soak · sustained traffic; choose a long duration"],
    ],
    draft.testKind,
  );
  const vus = input(String(draft.vus), "number");
  vus.min = "1";
  vus.max = "10000";
  vus.required = true;
  const duration = input(draft.duration);
  duration.required = true;
  const name = input(draft.name);
  name.placeholder = "Optional test name";
  const workload = element("div", undefined, "grid");
  workload.append(
    field("Test type", preset),
    field(
      "Virtual users",
      vus,
      "Concurrent users, each repeating the request.",
    ),
    field("Duration", duration, "Examples: 10s, 30s, 5m."),
  );
  preset.addEventListener("change", () => {
    const presets: Record<string, [string, string]> = {
      smoke: ["1", "10s"],
      load: ["10", "30s"],
      stress: ["10", "30s"],
      spike: ["30", "10s"],
      soak: ["5", "30m"],
    };
    [vus.value, duration.value] = presets[preset.value] ?? ["1", "10s"];
  });
  const advanced = element("details");
  advanced.append(element("summary", "Advanced request options"));
  const body = element("textarea");
  body.dataset.bindingTarget = "body";
  url.dataset.bindingTarget = "url";
  body.value = draft.body;
  body.rows = 5;
  body.placeholder = "Optional request body";
  const headers = element("textarea");
  headers.value = JSON.stringify(draft.headers, null, 2);
  headers.rows = 3;
  headers.spellcheck = false;
  const bodyMode = select(
    [
      ["text", "Plain text"],
      ["json", "JSON"],
      ["form", "Form-encoded fields (JSON object)"],
      ["multipart", "Multipart fields (JSON object)"],
    ],
    draft.bodyMode,
  );
  const expected = input(
    draft.expectedStatus === undefined ? "" : String(draft.expectedStatus),
    "number",
  );
  expected.min = "100";
  expected.max = "599";
  const sleep = input(String(draft.sleep), "number");
  sleep.min = "0";
  sleep.step = "0.1";
  const thresholds = element("textarea");
  thresholds.rows = 3;
  thresholds.value = JSON.stringify(draft.thresholds, null, 2);
  thresholds.spellcheck = false;
  advanced.append(
    field("Test name", name),
    field(
      "Headers (JSON object)",
      headers,
      "Use ${API_TOKEN} for sensitive values; the variable must exist in the extension host environment.",
    ),
    field("Body format", bodyMode),
    field("Request body", body),
    field(
      "Expected status",
      expected,
      "Checks alone do not fail a run; add a checks threshold to enforce them.",
    ),
    field("Think time (seconds)", sleep),
    field(
      "Thresholds (JSON object)",
      thresholds,
      'Example: {"http_req_duration":["p(95)<500"],"checks":["rate>0.99"]}',
    ),
  );
  const upload = element("details");
  upload.append(element("summary", "Multipart file upload"));
  const uploadField = input(draft.upload?.field ?? "file"),
    uploadName = input(draft.upload?.filename ?? "upload.bin"),
    uploadType = input(draft.upload?.contentType ?? "application/octet-stream");
  upload.append(
    button("Choose upload file", () =>
      post({ type: "chooseFile", purpose: "upload" }),
    ),
    field("File field name", uploadField),
    field("Upload filename", uploadName),
    field("Upload content type", uploadType),
    element(
      "p",
      draft.upload?.path ?? "No upload selected. Maximum file size: 20 MiB.",
    ),
  );
  advanced.append(upload);
  const builder = workloadBuilder(
    draft,
    state?.runs.flatMap((run) => run.metricCatalog ?? []) ?? [],
    false,
    post,
  );
  advanced.append(
    builder,
    integrationBuilder(draft, post, state?.installation.externalOutputs ?? []),
  );
  advanced.addEventListener("protocolChanged", () =>
    builder.dispatchEvent(new Event("refreshBuilder")),
  );
  const error = element("p", undefined, "error");
  error.setAttribute("role", "alert");
  const read = (): QuickTest => {
    Object.assign(draft, {
      ...draft,
      scenarios: draft.scenarios,
      checks: draft.checks,
      thresholdRules: draft.thresholdRules,
      name: name.value,
      url: url.value,
      method: method.value,
      testKind: preset.value as QuickTest["testKind"],
      vus: Number(vus.value),
      duration: duration.value,
      sleep: Number(sleep.value),
      headers: JSON.parse(headers.value),
      body: body.value,
      bodyMode: bodyMode.value as QuickTest["bodyMode"],
      expectedStatus: expected.value ? Number(expected.value) : undefined,
      thresholds: JSON.parse(thresholds.value),
      upload: draft.upload
        ? {
            ...draft.upload,
            field: uploadField.value,
            filename: uploadName.value,
            contentType: uploadType.value,
          }
        : undefined,
    });
    remember();
    return draft;
  };
  const perform = (type: "run" | "save" | "preview" | "saveTemplate") => {
    try {
      if (form.reportValidity()) post({ type, config: read() });
    } catch {
      error.textContent = "Headers and thresholds must be valid JSON objects.";
    }
  };
  const actions = element("div", undefined, "actions");
  const run = button(
    state?.active ? "Test running…" : "Run Test",
    () => perform("run"),
    "primary",
  );
  run.disabled = !!state?.active;
  actions.append(
    run,
    button("Preview script", () => perform("preview")),
    button("Save as k6 Script", () => perform("save")),
    button("Save test configuration", () => perform("saveTemplate")),
  );
  form.append(target, workload, advanced, error, actions);
  form.addEventListener("insertBinding", (event) => {
    const { target, placeholder } = (
      event as CustomEvent<{ target: string; placeholder: string }>
    ).detail;
    const control = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[data-binding-target="${target}"]`,
    );
    if (control) {
      control.setRangeText(
        placeholder,
        control.selectionStart ?? control.value.length,
        control.selectionEnd ?? control.value.length,
        "end",
      );
      control.dispatchEvent(new Event("change", { bubbles: true }));
      control.focus();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    perform("run");
  });
  form.addEventListener("change", () => {
    try {
      read();
    } catch {
      return;
    }
  });
  return form;
}
function home(): HTMLElement {
  const main = element("main");
  main.append(
    heading(
      "Test your API’s performance",
      "Paste a URL. Choose your workload. Understand what happens.",
    ),
  );
  if (!state!.installation.ready) {
    const setup = notice(
      state!.installation.error ??
        "Checking k6 in the extension host environment…",
    );
    const a = element("a", "Install Grafana k6");
    a.href = "https://grafana.com/docs/k6/latest/set-up/install-k6/";
    setup.append(
      element("br"),
      a,
      button("Retry detection", () => post({ type: "check" })),
    );
    main.append(setup);
  } else
    main.append(
      element(
        "p",
        `${state!.installation.version} · ready in extension host`,
        "muted",
      ),
    );
  const card = element("section", undefined, "card");
  card.append(configForm());
  main.append(card);
  const recent = element("section");
  recent.append(element("h2", "Recent runs"));
  if (!state!.runs.length)
    recent.append(
      notice(
        "Your first result starts here. Completed, failed and cancelled runs will appear in History.",
      ),
    );
  else recent.append(runTable(state!.runs.slice(0, 5), false));
  main.append(
    recent,
    button("Run an existing script…", () => post({ type: "runFile" })),
  );
  return main;
}
const metricDefinitions: [keyof Metrics, string, string][] = [
  ["requests", "HTTP requests", "requests"],
  ["rps", "Throughput", "req/s"],
  ["avg", "Average latency", "ms"],
  ["p95", "p95 latency", "ms"],
  ["failureRate", "HTTP failure rate", "%"],
  ["vus", "Active VUs", "users"],
];
function metrics(run: Run): HTMLElement {
  if (run.protocol === "ws" || run.protocol === "grpc") {
    const grid = element("div", undefined, "metrics");
    for (const [key, value] of Object.entries(run.protocolMetrics ?? {})) {
      const card = element("div", undefined, "metric");
      card.append(element("span", key), element("strong", format(value)));
      grid.append(card);
    }
    if (!grid.children.length)
      grid.append(
        notice(
          "No protocol measurements available yet. HTTP metrics are not available for this protocol.",
        ),
      );
    return grid;
  }
  const grid = element("div", undefined, "metrics");
  for (const [key, label, unit] of metricDefinitions) {
    const card = element("div", undefined, "metric");
    card.append(
      element("span", label),
      element(
        "strong",
        format(
          key === "failureRate" && run.metrics[key] !== undefined
            ? run.metrics[key]! * 100
            : run.metrics[key],
        ),
      ),
      element("small", unit),
    );
    if (key === "p95")
      card.title =
        "Authoritative run-wide 95th percentile, when a k6 summary is available.";
    grid.append(card);
  }
  if (run.protocol === "mixed")
    grid.append(...metrics({ ...run, protocol: "ws" }).children);
  return grid;
}
function chart(
  run: Run,
  key: ChartMetric,
  label: string,
  scale?: ChartScale,
): HTMLElement {
  const card = element("section", undefined, "chart card");
  card.append(element("h3", label));
  const values = seriesPoints(run, key);
  if (!values.length) {
    card.append(element("p", "No measurements available.", "muted"));
    return card;
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 600 180");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${label}, elapsed seconds, peak ${format(Math.max(...values.map((p) => p.y)))}`,
  );
  const { maximum, end } = scale ?? sharedChartScale([run], key);
  svg.setAttribute("data-axis-max", String(maximum));
  svg.setAttribute("data-axis-end", String(end));
  const line = document.createElementNS(svg.namespaceURI, "polyline");
  line.setAttribute(
    "points",
    values
      .map((p) => `${40 + (p.x / end) * 540},${145 - (p.y / maximum) * 120}`)
      .join(" "),
  );
  line.setAttribute("class", "chart-line");
  svg.append(line);
  for (const point of values.filter(
    (_, index) => index % Math.max(1, Math.ceil(values.length / 120)) === 0,
  )) {
    const marker = document.createElementNS(svg.namespaceURI, "circle");
    marker.setAttribute("cx", String(40 + (point.x / end) * 540));
    marker.setAttribute("cy", String(145 - (point.y / maximum) * 120));
    marker.setAttribute("r", "4");
    marker.setAttribute("class", "chart-point");
    const title = document.createElementNS(svg.namespaceURI, "title");
    title.textContent = `${format(point.x)}s · ${format(point.y)}`;
    marker.append(title);
    svg.append(marker);
  }
  const text = (x: number, y: number, value: string) => {
    const t = document.createElementNS(svg.namespaceURI, "text");
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y));
    t.textContent = value;
    svg.append(t);
  };
  text(2, 20, format(maximum, 1));
  text(25, 150, "0");
  text(40, 175, "0s");
  text(530, 175, `${format(end, 1)}s`);
  card.append(svg);
  const details = element("details");
  details.append(element("summary", "View measurements"));
  const table = element("table");
  for (const p of values) {
    const row = element("tr");
    row.append(element("td", `${p.x}s`), element("td", format(p.y)));
    table.append(row);
  }
  details.append(table);
  card.append(details);
  return card;
}
function dashboard(): HTMLElement {
  const main = element("main");
  const run = state!.active ?? state!.selected;
  if (!run) {
    main.append(
      heading(
        "Your performance dashboard",
        "Run a test or open a result from History.",
      ),
      button(
        "Create a test",
        () => post({ type: "navigate", screen: "home" }),
        "primary",
      ),
    );
    return main;
  }
  if (dashboardRunId !== run.id) {
    dashboardRunId = run.id;
    dashboardScenario = "";
  }
  main.append(
    heading(run.name, `${run.testKind.toUpperCase()} · ${run.target}`),
  );
  const strip = element("div", undefined, "run-status");
  strip.setAttribute("role", "status");
  strip.append(
    element("strong", status(run)),
    element(
      "span",
      `${format(run.elapsedMs / 1000, 0)}s elapsed · ${new Date(run.startedAt).toLocaleString()}`,
    ),
  );
  if (state!.active)
    strip.append(
      button("Stop Test", () => post({ type: "stop", id: run.id }), "danger"),
    );
  main.append(strip, metrics(run));
  if (run.observation === "threshold-aborted")
    main.append(
      notice(
        `k6 stopped this test early after an aborting threshold failed. Observed ${format((run.engineElapsedMs ?? run.elapsedMs) / 1000)}s of the planned ${format((run.plannedDurationMs ?? 0) / 1000)}s workload. These measurements do not cover the full schedule.`,
      ),
    );
  else if (run.observation === "threshold-abort-possible")
    main.append(
      notice(
        "An aborting threshold failed. The iteration workload has no known finish time, so early termination cannot be determined from duration. Treat these results as potentially incomplete.",
      ),
    );
  if (run.scenarioMetrics && Object.keys(run.scenarioMetrics).length) {
    if (dashboardScenario && !run.scenarioMetrics[dashboardScenario])
      dashboardScenario = "";
    const filter = select(
      [
        ["", "All scenarios"],
        ...Object.keys(run.scenarioMetrics).map(
          (name) => [name, name] as [string, string],
        ),
      ],
      dashboardScenario,
    );
    filter.setAttribute("aria-label", "Scenario metrics");
    const scoped = element("div");
    const showScope = () => {
      scoped.replaceChildren();
      if (!dashboardScenario) return;
      const scopedData = scopedRun(run, dashboardScenario);
      scoped.append(
        element("h2", `Scenario: ${dashboardScenario}`),
        metrics(scopedData),
        notice(
          "Scenario values are observed aggregates over the full run window. VU counts and final percentiles may be unavailable at this scope.",
        ),
      );
      if (run.protocol !== "ws" && run.protocol !== "grpc") {
        const charts = element("div", undefined, "charts");
        charts.append(
          chart(scopedData, "latency", "Scenario average latency · ms"),
          chart(scopedData, "requests", "Scenario throughput · req/s"),
        );
        scoped.append(charts);
      }
    };
    filter.addEventListener("change", () => {
      dashboardScenario = filter.value;
      showScope();
    });
    showScope();
    main.append(field("Scenario", filter), scoped);
  }
  if (run.metrics.droppedIterations !== undefined)
    main.append(
      notice(
        `Dropped iterations: ${format(run.metrics.droppedIterations, 0)}. Nonzero values mean the requested iteration schedule was not fully achieved.`,
      ),
    );
  const charts = element("div", undefined, "charts");
  charts.append(
    chart(run, "requests", "Throughput · req/s"),
    chart(run, "latency", "Average latency · ms"),
    chart(run, "failures", "HTTP failures · %"),
    chart(run, "vus", "Virtual users"),
  );
  if (run.protocol !== "ws" && run.protocol !== "grpc") main.append(charts);
  main.append(
    notice(
      run.summarySource === "k6-summary"
        ? "Final percentiles come from k6’s end-of-test summary."
        : "Observed metrics. Authoritative final percentiles and thresholds are unavailable until a generated test produces its summary.",
    ),
  );
  const protocols = Object.entries(run.protocolMetrics ?? {}).filter(([key]) =>
    key.startsWith("negotiated."),
  );
  if (protocols.length)
    main.append(
      element(
        "p",
        `Negotiated protocols observed: ${protocols.map(([key, value]) => `${key.slice(11)} (${format(value, 0)} requests)`).join(", ")}`,
      ),
    );
  const metadata = element("details");
  metadata.append(
    element("summary", "Execution configuration"),
    element(
      "p",
      `${run.k6Version} · Exit code: ${run.exitCode ?? "unavailable"} · Source: ${run.summarySource}`,
    ),
    element("p", `p99 latency: ${format(run.metrics.p99)} ms`),
  );
  for (const [key, value] of Object.entries(run.conditions ?? {}))
    metadata.append(element("p", `${key}: ${value}`));
  main.append(metadata);
  if (run.thresholds.length) {
    const section = element("section", undefined, "card");
    section.append(element("h2", "Thresholds"));
    for (const t of run.thresholds)
      section.append(
        element(
          "p",
          `${thresholdText(t)} · ${t.metric} · ${t.expression} · observed ${format(t.observedValue)} ${t.unit ?? ""}${t.abortOnFail ? " · abort on failure" : ""}${t.delayAbortEval ? " after " + t.delayAbortEval : ""}`,
        ),
      );
    main.append(section);
  }
  if (run.checkResults?.length) {
    const checks = element("section", undefined, "card");
    checks.append(element("h2", "Check results"));
    for (const check of run.checkResults)
      checks.append(
        element(
          "p",
          `${check.group ? check.group + " / " : ""}${check.name} · ${check.passes} passed · ${check.fails} failed${check.scenario ? " · " + check.scenario : ""}${check.request ? " · request: " + check.request : ""} · ${check.source ?? "k6-summary"}`,
        ),
      );
    main.append(checks);
  }
  if (run.metrics.checksPassed !== undefined)
    main.append(
      element(
        "p",
        `Checks: ${format(run.metrics.checksPassed, 0)} passed · ${format(run.metrics.checksFailed, 0)} failed. Checks alone do not determine exit status.`,
      ),
    );
  const actions = element("div", undefined, "actions");
  if (!state!.active) {
    const rerun = button("Run Again", () =>
      post({ type: "rerun", id: run.id }),
    );
    rerun.disabled = !run.rerunnable;
    if (run.config)
      actions.append(
        button("Save as Script", () =>
          post({ type: "save", config: run.config! }),
        ),
      );
    actions.append(
      rerun,
      button("Edit configuration", () => {
        if (run.templateId) {
          post({ type: "openTemplate", id: run.templateId });
          return;
        }
        draft = run.config ?? {
          ...defaultTest,
          url: run.target,
          method: run.method === "Script" ? "GET" : run.method,
          testKind: run.testKind === "custom" ? "smoke" : run.testKind,
        };
        post({ type: "navigate", screen: "home" });
      }),
      button("Export JSON", () => post({ type: "export", id: run.id })),
      button("Export CSV", () =>
        post({ type: "export", id: run.id, format: "csv" }),
      ),
      button("HTML report", () =>
        post({ type: "export", id: run.id, format: "html" }),
      ),
      button("Compare", () => {
        baseline = run.id;
        post({ type: "navigate", screen: "compare" });
      }),
    );
  }
  actions.append(button("Open Logs", () => post({ type: "logs" })));
  main.append(actions);
  const logs = element("details");
  logs.append(element("summary", "Execution logs"));
  const pre = element("pre", run.logs.join("\n"));
  const errorsOnly = input("", "checkbox");
  errorsOnly.addEventListener("change", () => {
    pre.textContent = run.logs
      .filter((line) => !errorsOnly.checked || /error|fail|warn/i.test(line))
      .join("\n");
  });
  logs.append(field("Errors and warnings only", errorsOnly), pre);
  main.append(logs);
  return main;
}
function runTable(runs: Run[], checkboxes: boolean): HTMLElement {
  const wrap = element("div", undefined, "table-scroll");
  const table = element("table");
  const head = element("tr");
  for (const label of [
    checkboxes ? "Select" : "",
    "Test / target",
    "Started",
    "Type",
    "Outcome",
    "p95 · ms",
    "req/s",
    "Errors · %",
    "Actions",
  ])
    head.append(element("th", label));
  table.append(head);
  for (const run of runs) {
    const row = element("tr");
    const selectCell = element("td");
    if (checkboxes) {
      const checkbox = input("", "checkbox");
      checkbox.checked = selected.includes(run.id);
      checkbox.setAttribute(
        "aria-label",
        `Select ${run.name} from ${run.startedAt}`,
      );
      checkbox.addEventListener("change", () => {
        selected = checkbox.checked
          ? [...selected, run.id]
          : selected.filter((id) => id !== run.id);
        render();
      });
      selectCell.append(checkbox);
    }
    row.append(selectCell);
    const name = element("td");
    name.append(
      button(run.name, () => post({ type: "open", id: run.id }), "text-button"),
      element("small", run.target),
    );
    row.append(
      name,
      element("td", new Date(run.startedAt).toLocaleString()),
      element("td", run.testKind),
      element("td", status(run)),
      element("td", format(run.metrics.p95)),
      element("td", format(run.metrics.rps)),
      element(
        "td",
        format(
          run.metrics.failureRate === undefined
            ? undefined
            : run.metrics.failureRate * 100,
        ),
      ),
    );
    const actions = element("td");
    actions.append(
      button(
        "Delete",
        () => post({ type: "delete", id: run.id }),
        "text-button",
      ),
    );
    row.append(actions);
    table.append(row);
  }
  wrap.append(table);
  return wrap;
}
function history(): HTMLElement {
  const main = element("main");
  main.append(
    heading(
      "Test history",
      "A local record of what ran, when it ran, and how it performed.",
    ),
  );
  const filters = element("div", undefined, "filters");
  const query = input(search, "search");
  query.placeholder = "Search tests or targets";
  query.setAttribute("aria-label", "Search history");
  query.addEventListener("change", () => {
    search = query.value;
    render();
  });
  const type = select(
    [
      ["", "All test types"],
      ...["smoke", "load", "stress", "spike", "soak", "custom"].map(
        (k) => [k, k] as [string, string],
      ),
    ],
    kind,
  );
  type.setAttribute("aria-label", "Test type");
  type.addEventListener("change", () => {
    kind = type.value;
    render();
  });
  const result = select(
    [
      ["", "All outcomes"],
      ["completed", "Completed"],
      ["threshold_failed", "Threshold failed"],
      ["execution_failed", "Execution failed"],
      ["cancelled", "Cancelled"],
    ],
    outcome,
  );
  result.setAttribute("aria-label", "Outcome");
  result.addEventListener("change", () => {
    outcome = result.value;
    render();
  });
  const order = select(
    [
      ["newest", "Newest first"],
      ["oldest", "Oldest first"],
    ],
    sort,
  );
  order.setAttribute("aria-label", "Sort");
  order.addEventListener("change", () => {
    sort = order.value;
    render();
  });
  const from = input(fromDate, "date"),
    to = input(toDate, "date");
  from.addEventListener("change", () => {
    fromDate = from.value;
    render();
  });
  to.addEventListener("change", () => {
    toDate = to.value;
    render();
  });
  filters.append(
    query,
    type,
    result,
    order,
    field("From date", from),
    field("Through date", to),
  );
  main.append(filters);
  const runs = state!.runs
    .filter(
      (r) =>
        (!fromDate || r.startedAt.slice(0, 10) >= fromDate) &&
        (!toDate || r.startedAt.slice(0, 10) <= toDate) &&
        (!kind || r.testKind === kind) &&
        (!outcome || r.state === outcome) &&
        `${r.name} ${r.target}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "oldest"
        ? a.startedAt.localeCompare(b.startedAt)
        : b.startedAt.localeCompare(a.startedAt),
    );
  if (runs.length) main.append(runTable(runs, true));
  else
    main.append(
      notice("No matching runs. Create a test or adjust your filters."),
    );
  const compare = button(
    `Compare Selected (${selected.length}/2)`,
    () => {
      const sorted = state!.runs
        .filter((r) => selected.includes(r.id))
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      baseline = sorted[0]!.id;
      candidate = sorted[1]!.id;
      post({ type: "navigate", screen: "compare" });
    },
    "primary",
  );
  compare.disabled = selected.length !== 2;
  main.append(
    compare,
    button("Clear history", () => post({ type: "clear" })),
  );
  return main;
}
function comparison(): HTMLElement {
  const main = element("main");
  main.append(
    heading(
      "Compare results",
      "Choose a baseline and candidate of the same test type.",
    ),
  );
  const options: [string, string][] = [
    ["", "Choose a run"],
    ...state!.runs.map(
      (r) =>
        [
          r.id,
          `${r.name} · ${r.testKind} · ${new Date(r.startedAt).toLocaleString()}`,
        ] as [string, string],
    ),
  ];
  const a = select(options, baseline),
    b = select(options, candidate);
  a.addEventListener("change", () => {
    baseline = a.value;
    render();
  });
  b.addEventListener("change", () => {
    candidate = b.value;
    render();
  });
  const selectors = element("div", undefined, "grid");
  selectors.append(
    field("Baseline", a),
    field("Candidate", b),
    button("Swap", () => {
      [baseline, candidate] = [candidate, baseline];
      render();
    }),
  );
  main.append(selectors);
  const first = state!.runs.find((r) => r.id === baseline),
    second = state!.runs.find((r) => r.id === candidate);
  if (!first || !second) {
    main.append(notice("Select two runs to view their recorded metrics."));
    return main;
  }
  const scenarios = commonScenarios(first, second);
  if (comparisonScenario && !scenarios.includes(comparisonScenario))
    comparisonScenario = "";
  const scope = select(
    [
      ["", "All scenarios"],
      ...scenarios.map((name) => [name, name] as [string, string]),
    ],
    comparisonScenario,
  );
  scope.addEventListener("change", () => {
    comparisonScenario = scope.value;
    render();
  });
  main.append(field("Comparison scenario", scope));
  if (comparisonScenario)
    main.append(
      notice(
        "Scenario values are observed aggregates over the full run window. Global percentiles and VU counts are not substituted when scenario measurements are unavailable.",
      ),
    );
  try {
    const comparison = compareRuns(first, second, comparisonScenario);
    main.append(
      notice(
        comparison.comparable
          ? "Comparable conditions. Two runs alone do not establish causation or statistical significance."
          : "Different test conditions",
      ),
    );
    for (const note of comparison.notes) main.append(notice(note));
    const table = element("table");
    const head = element("tr");
    for (const label of [
      "Metric",
      "Baseline",
      "Candidate",
      "Difference",
      "Relative change",
      "Interpretation",
    ])
      head.append(element("th", label));
    table.append(head);
    for (const row of comparison.rows) {
      const tr = element("tr");
      const scale = row.key === "failureRate" ? 100 : 1;
      tr.append(
        element("td", `${row.label} · ${row.unit}`),
        element(
          "td",
          format(row.baseline === undefined ? undefined : row.baseline * scale),
        ),
        element(
          "td",
          format(
            row.candidate === undefined ? undefined : row.candidate * scale,
          ),
        ),
        element(
          "td",
          `${format(row.delta === undefined ? undefined : row.delta * scale)}${row.key === "failureRate" ? " percentage points" : ""}`,
        ),
        element(
          "td",
          `${format(row.percent)}${row.percent === undefined ? "" : "%"}`,
        ),
        element("td", row.interpretation),
      );
      table.append(tr);
    }
    const scroll = element("div", undefined, "table-scroll");
    scroll.append(table);
    main.append(
      scroll,
      element(
        "p",
        `Baseline: ${status(first)} · Candidate: ${status(second)}. Durations: ${format(first.elapsedMs / 1000)}s / ${format(second.elapsedMs / 1000)}s.`,
      ),
    );
    const scopedFirst = scopedRun(first, comparisonScenario),
      scopedSecond = scopedRun(second, comparisonScenario);
    const chartSelector = select(
      [
        ["latency", "Average latency · ms"],
        ["requests", "Throughput · req/s"],
        ["failures", "HTTP failure rate · %"],
        ["vus", "Virtual users"],
      ],
      comparisonChart,
    );
    chartSelector.addEventListener("change", () => {
      comparisonChart = chartSelector.value as ChartMetric;
      render();
    });
    const charts = element("div", undefined, "charts");
    if (first.protocol === "ws" || first.protocol === "grpc")
      charts.append(
        notice(
          "Protocol summary metrics are compared above. Protocol-specific time series are not retained in this preview.",
        ),
      );
    else {
      main.append(
        field("Comparison chart", chartSelector),
        notice(
          "Charts use identical axes and elapsed seconds since each run started. Different run durations remain visible.",
        ),
      );
      const scale = sharedChartScale(
        [scopedFirst, scopedSecond],
        comparisonChart,
      );
      charts.append(
        chart(
          scopedFirst,
          comparisonChart,
          "Baseline · " + chartSelector.selectedOptions[0]!.textContent,
          scale,
        ),
        chart(
          scopedSecond,
          comparisonChart,
          "Candidate · " + chartSelector.selectedOptions[0]!.textContent,
          scale,
        ),
      );
      if (
        comparisonChart === "requests" &&
        [scopedFirst, scopedSecond].some((run) =>
          run.series.some((bucket) => bucket.widthSeconds === undefined),
        )
      )
        charts.append(
          notice(
            "Older stored results lack exact bucket widths, so their throughput chart is unavailable. Recorded summary requests/sec remains available.",
          ),
        );
    }
    main.append(
      charts,
      button("Open baseline", () => post({ type: "open", id: first.id })),
      button("Open candidate", () => post({ type: "open", id: second.id })),
    );
  } catch (error) {
    main.append(notice((error as Error).message));
  }
  return main;
}
function saved(): HTMLElement {
  const main = element("main");
  main.append(
    heading(
      "Saved tests",
      "Reuse protected configurations or edit them before running.",
    ),
    notice(
      "Request settings are kept in VS Code SecretStorage. This list contains names and identifiers only. Credential values remain separate protected runtime variables.",
    ),
  );
  for (const test of state!.templates ?? []) {
    const card = element("section", undefined, "card");
    card.append(
      element("h2", test.name),
      element("p", new Date(test.updatedAt).toLocaleString()),
      button("Edit saved test", () =>
        post({ type: "openTemplate", id: test.id }),
      ),
      button(
        "Run saved test",
        () => post({ type: "runTemplate", id: test.id }),
        "primary",
      ),
      button("Delete saved test", () =>
        post({ type: "deleteTemplate", id: test.id }),
      ),
    );
    main.append(card);
  }
  if (!state!.templates?.length)
    main.append(
      notice(
        "No saved tests yet. Configure a test and choose Save test configuration.",
      ),
    );
  main.append(
    button("New test", () => post({ type: "navigate", screen: "home" })),
  );
  return main;
}
function render(): void {
  if (!state) return;
  root.replaceChildren(navigation());
  if (state.error) {
    const error = notice(state.error);
    error.setAttribute("role", "alert");
    root.append(error);
  }
  root.append(
    { home, run: dashboard, history, compare: comparison, saved }[
      state.screen
    ](),
  );
}
window.addEventListener(
  "message",
  (event: MessageEvent<{ type: string; state: ViewState }>) => {
    if (event.data.type !== "state") return;
    const previous = state;
    state = event.data.state;
    if (initial) {
      draft = { ...defaultTest, ...state.defaults };
      const saved = api.getState() as
        { draft?: Partial<QuickTest> } | undefined;
      if (saved?.draft) {
        const d = saved.draft;
        if (
          ["smoke", "load", "stress", "spike", "soak"].includes(
            d.testKind ?? "",
          )
        )
          draft.testKind = d.testKind!;
        if (Number.isInteger(d.vus) && d.vus! >= 1 && d.vus! <= 10000)
          draft.vus = d.vus!;
        if (typeof d.duration === "string" && /^\d+(s|m|h)$/.test(d.duration))
          draft.duration = d.duration;
      }
      if (draft.testKind === "load" && draft.vus === 1) {
        draft.vus = 10;
        draft.duration = "30s";
      }
      initial = false;
    }
    if (
      previous?.screen === "home" &&
      state.screen === "home" &&
      root.querySelector("form") &&
      previous.error === state.error &&
      previous.installation.ready === state.installation.ready &&
      previous.installation.version === state.installation.version
    )
      return;
    render();
  },
);
post({ type: "ready" });

window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data;
  if (data.type === "loadConfig") {
    draft = data.config;
    render();
    for (const detail of root.querySelectorAll("details")) detail.open = true;
    return;
  }
  if (!["fileChosen", "protoMethods"].includes(data.type)) return;
  const config = data.scenario
    ? draft.scenarios?.find((s) => s.name === data.scenario)?.request
    : draft;
  if (!config) return;
  if (data.type === "protoMethods") {
    if (config.protocol) config.protocol.methods = data.methods;
    render();
    for (const detail of root.querySelectorAll("details")) detail.open = true;
    return;
  }
  if (data.purpose === "upload")
    config.upload = {
      path: data.path,
      field: config.upload?.field ?? "file",
      filename: data.path.split(/[\\/]/).pop() ?? "upload.bin",
      contentType: "application/octet-stream",
    };
  else if (data.purpose === "proto" && config.protocol) {
    config.protocol.protoFile = data.path;
    config.protocol.methods = data.methods;
  } else if (data.purpose === "dataset" && config.dataset) {
    config.dataset.file = data.path;
    config.dataset.format = data.format;
    config.dataset.columns = data.schema;
    config.dataset.rowCount = data.rowCount;
  } else if (data.purpose === "jsonOutput" || data.purpose === "csvOutput") {
    draft.outputs ??= [];
    draft.outputs.push({
      format: data.purpose === "jsonOutput" ? "json" : "csv",
      path: data.path,
    });
  }
  render();
  for (const detail of root.querySelectorAll("details")) detail.open = true;
  if (data.purpose === "dataset") {
    const n = notice(
      `Dataset: ${data.rowCount} rows · columns: ${data.columns.join(", ")}. Row values are not stored in history.`,
    );
    root.querySelector("main")?.prepend(n);
  }
});
