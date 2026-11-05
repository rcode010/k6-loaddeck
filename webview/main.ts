import { compareRuns } from "../src/comparison";
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
let baseline = "";
let candidate = "";
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
function status(run: Run): string {
  return {
    starting: "Starting",
    running: "Running",
    stopping: "Stopping",
    completed: run.thresholds.length
      ? "Completed · thresholds met"
      : "Completed · no thresholds",
    threshold_failed: "Threshold failed",
    execution_failed: "Execution failed",
    cancelled: "Cancelled",
  }[run.state];
}
function navigation(): HTMLElement {
  const e = element("nav", undefined, "navigation");
  e.setAttribute("aria-label", "LoadDeck navigation");
  e.append(element("strong", "LoadDeck", "brand"));
  for (const [screen, label] of [
    ["home", "New test"],
    ["run", "Dashboard"],
    ["history", "History"],
    ["compare", "Compare"],
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
  api.setState({ draft: { ...draft, url: "", body: "", headers: {} } });
}
function configForm(): HTMLElement {
  const form = element("form", undefined, "test-form");
  const url = input(draft.url, "url");
  url.required = true;
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
    vus.value = preset.value === "load" ? "10" : "1";
    duration.value = preset.value === "load" ? "30s" : "10s";
  });
  const advanced = element("details");
  advanced.append(element("summary", "Advanced request options"));
  const body = element("textarea");
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
  const error = element("p", undefined, "error");
  error.setAttribute("role", "alert");
  const read = (): QuickTest => {
    draft = {
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
    };
    remember();
    return draft;
  };
  const perform = (type: "run" | "save" | "preview") => {
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
  );
  form.append(target, workload, advanced, error, actions);
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
  return grid;
}
function chart(
  run: Run,
  key: "requests" | "latency" | "failures" | "vus",
  label: string,
): HTMLElement {
  const card = element("section", undefined, "chart card");
  card.append(element("h3", label));
  const values = run.series
    .map((b, i) => {
      const width =
        (run.series[i + 1]?.elapsed ??
          b.elapsed +
            (run.series[i - 1] ? b.elapsed - run.series[i - 1]!.elapsed : 1)) -
        b.elapsed;
      return {
        x: b.elapsed,
        y:
          key === "requests"
            ? b.requests / Math.max(width, 1)
            : key === "latency"
              ? b.latencyCount
                ? b.latencySum / b.latencyCount
                : undefined
              : key === "failures"
                ? b.failureCount
                  ? (100 * b.failures) / b.failureCount
                  : undefined
                : b.vus,
      };
    })
    .filter((p): p is { x: number; y: number } => p.y !== undefined);
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
  const maximum = Math.max(...values.map((p) => p.y), 0.001),
    end = Math.max(...values.map((p) => p.x), 1);
  const line = document.createElementNS(svg.namespaceURI, "polyline");
  line.setAttribute(
    "points",
    values
      .map((p) => `${40 + (p.x / end) * 540},${145 - (p.y / maximum) * 120}`)
      .join(" "),
  );
  line.setAttribute("class", "chart-line");
  svg.append(line);
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
  text(530, 175, `${format(end, 0)}s`);
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
    strip.append(button("Stop Test", () => post({ type: "stop" }), "danger"));
  main.append(strip, metrics(run));
  const charts = element("div", undefined, "charts");
  charts.append(
    chart(run, "requests", "Throughput · req/s"),
    chart(run, "latency", "Average latency · ms"),
    chart(run, "failures", "HTTP failures · %"),
    chart(run, "vus", "Virtual users"),
  );
  main.append(charts);
  main.append(
    notice(
      run.summarySource === "k6-summary"
        ? "Final percentiles come from k6’s end-of-test summary."
        : "Observed metrics. Authoritative final percentiles and thresholds are unavailable until a generated test produces its summary.",
    ),
  );
  if (run.thresholds.length) {
    const section = element("section", undefined, "card");
    section.append(element("h2", "Thresholds"));
    for (const t of run.thresholds)
      section.append(
        element(
          "p",
          `${t.ok ? "Met" : "Failed"} · ${t.metric} · ${t.expression}`,
        ),
      );
    main.append(section);
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
    actions.append(
      rerun,
      button("Edit configuration", () => {
        if (run.config) draft = run.config;
        post({ type: "navigate", screen: "home" });
      }),
      button("Export JSON", () => post({ type: "export", id: run.id })),
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
  logs.append(pre);
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
  filters.append(query, type, result, order);
  main.append(filters);
  const runs = state!.runs
    .filter(
      (r) =>
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
  try {
    const comparison = compareRuns(first, second);
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
    const charts = element("div", undefined, "charts");
    charts.append(
      chart(first, "latency", "Baseline latency · elapsed seconds"),
      chart(second, "latency", "Candidate latency · elapsed seconds"),
    );
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
function render(): void {
  if (!state) return;
  root.replaceChildren(navigation());
  if (state.error) {
    const error = notice(state.error);
    error.setAttribute("role", "alert");
    root.append(error);
  }
  root.append(
    { home, run: dashboard, history, compare: comparison }[state.screen](),
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
