import type { QuickTest, ClientMessage } from "../src/model";
import type {
  Authentication,
  ProtocolConfig,
  Dataset,
} from "../src/integrations";
const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  return e;
};
function button(text: string, action: () => void): HTMLButtonElement {
  const e = node("button", text);
  e.type = "button";
  e.className = "secondary";
  e.addEventListener("click", action);
  return e;
}
function field(
  label: string,
  value: string | number | boolean,
  update: (value: string) => void,
  options?: string[],
): HTMLElement {
  const wrap = node("label");
  wrap.className = "field";
  wrap.append(node("span", label));
  const e = options ? node("select") : node("input");
  if (e instanceof HTMLSelectElement)
    for (const option of options!) {
      const o = node("option", option);
      o.value = option;
      e.append(o);
    }
  else {
    e.type =
      typeof value === "boolean"
        ? "checkbox"
        : typeof value === "number"
          ? "number"
          : "text";
    if (typeof value === "boolean") e.checked = value;
  }
  e.setAttribute("aria-label", label);
  if (["Message to send", "Request message (JSON)"].includes(label))
    e.dataset.bindingTarget = "message";
  e.value = String(value);
  e.addEventListener("change", () =>
    update(
      e instanceof HTMLInputElement && e.type === "checkbox"
        ? String(e.checked)
        : e.value,
    ),
  );
  wrap.append(e);
  return wrap;
}
function section(title: string, description: string): HTMLDetailsElement {
  const e = node("details");
  e.append(node("summary", title), node("p", description));
  return e;
}
export function integrationBuilder(
  config: QuickTest,
  post: (m: ClientMessage) => void,
  availableOutputs: string[] = [],
  requestOnly = false,
): HTMLElement {
  const root = node("div");
  function render(): void {
    const opened = new Set(
      [...root.querySelectorAll("details[open]")].map(
        (d) => d.querySelector("summary")?.textContent,
      ),
    );
    root.replaceChildren();
    const protocol = section(
      "Protocol",
      "HTTP/2 is negotiated by k6 when supported by the server. WebSocket uses the built-in k6/ws API. gRPC supports unary calls with a local schema.",
    );
    const p = config.protocol ?? {
      kind: "http",
      message: "{}",
      sessionMs: 1000,
      grpcMethod: "",
      protoFile: "",
      importPaths: [],
      plaintext: true,
    };
    protocol.append(
      field(
        "Protocol",
        p.kind,
        (value) => {
          config.protocol = { ...p, kind: value as ProtocolConfig["kind"] };
          render();
          root.dispatchEvent(
            new CustomEvent("protocolChanged", { bubbles: true }),
          );
        },
        ["http", "http2", "ws", "grpc"],
      ),
    );
    if (p.kind !== "ws")
      protocol.append(
        field("Request timeout", p.timeout ?? "30s", (v) => {
          p.timeout = v;
          config.protocol = p;
        }),
      );
    if (["http", "http2"].includes(p.kind))
      protocol.append(
        field("Maximum redirects", p.redirects ?? 10, (v) => {
          p.redirects = Number(v);
          config.protocol = p;
        }),
      );
    if (p.kind === "ws")
      protocol.append(
        field("Message to send", p.message, (v) => (p.message = v)),
        field(
          "Session duration (ms)",
          p.sessionMs,
          (v) => (p.sessionMs = Number(v)),
        ),
      );
    if (p.kind === "ws") {
      protocol.append(
        field(
          "Minimum received messages",
          p.expectedMessages ?? 0,
          (v) => (p.expectedMessages = Number(v)),
        ),
        field(
          "Receive deadline (ms)",
          p.receiveDeadlineMs ?? p.sessionMs,
          (v) => (p.receiveDeadlineMs = Number(v)),
        ),
      );
      for (const [index, message] of (p.messages ?? []).entries())
        protocol.append(
          field(
            `Message ${index + 1} text`,
            message.text,
            (v) => (message.text = v),
          ),
          field(
            `Message ${index + 1} delay (ms)`,
            message.delayMs,
            (v) => (message.delayMs = Number(v)),
          ),
          button(`Remove message ${index + 1}`, () => {
            p.messages!.splice(index, 1);
            render();
          }),
        );
      protocol.append(
        button("Add scheduled message", () => {
          p.messages ??= [{ text: p.message, delayMs: 0 }];
          p.messages.push({ text: "hello", delayMs: 100 });
          render();
        }),
        node(
          "p",
          "Scheduled messages replace the single message. Receive expectations count messages received before the deadline. A checks threshold makes unmet expectations fail the run.",
        ),
      );
    }
    if (p.kind === "grpc")
      protocol.append(
        field("Proto file", p.protoFile, (v) => (p.protoFile = v)),
        button("Choose .proto file", () =>
          post({ type: "chooseFile", purpose: "proto" }),
        ),
        field(
          "Import directories (semicolon separated)",
          p.importPaths.join(";"),
          (v) => (p.importPaths = v.split(";").filter(Boolean)),
        ),
        field("Service / method", p.grpcMethod, (v) => (p.grpcMethod = v)),
        field("Request message (JSON)", p.message, (v) => (p.message = v)),
        field(
          "Plaintext (grpc://); disable for grpcs://",
          p.plaintext,
          (v) => (p.plaintext = v === "true"),
        ),
      );
    if (p.kind === "grpc")
      protocol.append(
        button("Read schema methods", () =>
          post({
            type: "inspectProto",
            file: p.protoFile,
            importPaths: p.importPaths,
          }),
        ),
        field(
          "Discovered unary method",
          p.grpcMethod,
          (v) => {
            p.grpcMethod = v;
            render();
          },
          ["", ...(p.methods ?? [])],
        ),
        node(
          "p",
          "Select a schema to discover unary service methods. Streaming methods remain available through existing scripts.",
        ),
      );
    root.append(protocol);
    const authentication = section(
      "Authentication",
      "Credentials are runtime variable references. Store values securely using VS Code SecretStorage, or set them in the extension host environment. Saved scripts contain variable names only. Environment injection does not provide k6 secret-source redaction guarantees.",
    );
    const a: Authentication = config.authentication ?? {
      mode: "none",
      usernameVariable: "LOADDECK_USER",
      secretVariable: "LOADDECK_TOKEN",
      keyName: "X-API-Key",
      placement: "header",
      tokenUrl: "",
      scope: "",
      audience: "",
      certificateVariable: "LOADDECK_CERT",
      privateKeyVariable: "LOADDECK_KEY",
    };
    authentication.append(
      field(
        "Authentication mode",
        a.mode,
        (v) => {
          config.authentication = { ...a, mode: v as Authentication["mode"] };
          render();
        },
        [
          "none",
          "basic",
          "digest",
          "ntlm",
          "bearer",
          "apiKey",
          "cookie",
          "oauth2",
          "mtls",
        ],
      ),
    );
    for (const option of authentication.querySelectorAll("option")) {
      if (
        (p.kind === "grpc" &&
          !["none", "bearer", "apiKey", "mtls"].includes(option.value)) ||
        (p.kind === "ws" && ["digest", "ntlm"].includes(option.value))
      ) {
        option.disabled = true;
        option.textContent += " (unavailable for this protocol)";
      }
    }
    if (a.mode !== "none") {
      if (["basic", "digest", "ntlm", "oauth2"].includes(a.mode))
        authentication.append(
          field(
            "Username / client ID variable",
            a.usernameVariable,
            (v) => (a.usernameVariable = v),
          ),
          button("Store username / client ID securely", () =>
            post({ type: "credential", name: a.usernameVariable }),
          ),
        );
      if (a.mode !== "mtls")
        authentication.append(
          field(
            "Secret variable",
            a.secretVariable,
            (v) => (a.secretVariable = v),
          ),
          button("Store secret securely", () =>
            post({ type: "credential", name: a.secretVariable }),
          ),
        );
      if (["apiKey", "cookie"].includes(a.mode))
        authentication.append(
          field(
            "Header / query / cookie name",
            a.keyName,
            (v) => (a.keyName = v),
          ),
        );
      if (a.mode === "apiKey")
        authentication.append(
          field(
            "Placement",
            a.placement,
            (v) => (a.placement = v as Authentication["placement"]),
            ["header", "query"],
          ),
          node(
            "p",
            "Query API keys can leak through server logs and raw output tags. Prefer headers.",
          ),
        );
      if (a.mode === "oauth2")
        authentication.append(
          field("Token endpoint", a.tokenUrl, (v) => (a.tokenUrl = v)),
          field("Scopes", a.scope, (v) => (a.scope = v)),
          field("Audience", a.audience, (v) => (a.audience = v)),
          node(
            "p",
            "Client credentials only. Tokens refresh per VU using expires_in with a five-second margin. The token endpoint receives real requests.",
          ),
        );
      if (a.mode === "mtls")
        authentication.append(
          field(
            "Certificate PEM variable",
            a.certificateVariable,
            (v) => (a.certificateVariable = v),
          ),
          button("Store certificate PEM", () =>
            post({ type: "credential", name: a.certificateVariable }),
          ),
          field(
            "Private key PEM variable",
            a.privateKeyVariable,
            (v) => (a.privateKeyVariable = v),
          ),
          button("Store private key PEM", () =>
            post({ type: "credential", name: a.privateKeyVariable }),
          ),
        );
    }
    authentication.append(
      node(
        "p",
        "Digest and NTLM are HTTP authentication schemes. NTLM usernames can include a domain (DOMAIN\\user); use the protected username variable.",
      ),
    );
    root.append(authentication);
    const data = section(
      "Test data",
      'Use {{column}} in URLs, headers, bodies and messages. JSON values can use a quoted "{{column}}" placeholder to preserve dataset types. SharedArray initializes file-backed rows once. Maximum dataset size: 20 MiB.',
    );
    const d: Dataset = config.dataset ?? {
      file: "",
      format: "json",
      strategy: "round-robin",
      exhaustion: "repeat",
      variables: {},
    };
    data.append(
      button("Enable test data", () => {
        config.dataset = { ...d };
        render();
      }),
    );
    if (config.dataset) {
      data.append(
        field(
          "File format",
          d.format,
          (v) => {
            d.format = v as Dataset["format"];
            render();
          },
          ["json", "csv"],
        ),
        field("Dataset path", d.file, (v) => (d.file = v)),
        button("Choose dataset", () =>
          post({ type: "chooseFile", purpose: "dataset", format: d.format }),
        ),
        field(
          "Row selection",
          d.strategy,
          (v) => (d.strategy = v as Dataset["strategy"]),
          ["round-robin", "random", "per-vu", "unique"],
        ),
        field(
          "Exhaustion policy",
          d.exhaustion,
          (v) => (d.exhaustion = v as Dataset["exhaustion"]),
          ["repeat", "fail"],
        ),
        node(
          "p",
          "Round-robin and unique use the scenario iteration index. Unique is scoped to each scenario, not globally across scenarios. Per-VU maps the VU ID to a row. Repeat wraps at the end; fail stops with a runtime error.",
        ),
      );
      if (d.rowCount)
        data.append(
          node(
            "p",
            `${d.rowCount} rows. Preview values are redacted; column names and inferred types are shown below.`,
          ),
        );
      const columns = [
        ...new Set([
          ...(d.columns ?? []).map((column) => column.name),
          ...Object.keys(d.types ?? {}),
        ]),
      ];
      for (const name of columns) {
        const inferred =
          d.columns?.find((column) => column.name === name)?.type ?? "unknown";
        data.append(
          field(
            `${name} · inferred ${inferred}`,
            d.types?.[name] ?? "infer",
            (v) => {
              d.types ??= {};
              if (v === "infer") delete d.types[name];
              else
                Object.defineProperty(d.types, name, {
                  value: v,
                  enumerable: true,
                  writable: true,
                  configurable: true,
                });
            },
            ["infer", "string", "number", "boolean", "json"],
          ),
        );
      }
      let column = columns[0] ?? "";
      let destination = "url";
      data.append(
        field("Binding column or JSON path", column, (v) => (column = v)),
        field("Insert binding into", destination, (v) => (destination = v), [
          "url",
          "body",
          "message",
        ]),
        button("Insert dataset binding", () => {
          if (!/^[A-Za-z0-9_.]+$/.test(column)) return;
          root.dispatchEvent(
            new CustomEvent("insertBinding", {
              bubbles: true,
              detail: { target: destination, placeholder: `{{${column}}}` },
            }),
          );
        }),
      );
      const variables = node("textarea");
      variables.value = JSON.stringify(d.variables, null, 2);
      variables.setAttribute(
        "aria-label",
        "Inline nonsecret variables as JSON",
      );
      variables.addEventListener("change", () => {
        try {
          d.variables = JSON.parse(variables.value);
          variables.setCustomValidity("");
        } catch {
          variables.setCustomValidity("Enter valid JSON variables.");
        }
      });
      data.append(
        variables,
        button("Remove test data", () => {
          delete config.dataset;
          render();
        }),
      );
    }
    root.append(data);
    const outputs = section(
      "Outputs",
      "Internal dashboard collection always remains enabled. Native JSON/CSV contains granular metric points; normalized exports are available on the results screen. Raw files can contain sensitive tags and are retained until you delete them.",
    );
    for (const [index, output] of (config.outputs ?? []).entries())
      outputs.append(
        node("p", `${output.format.toUpperCase()} · ${output.path}`),
        button("Remove output", () => {
          config.outputs!.splice(index, 1);
          render();
        }),
      );
    outputs.append(
      button("Add native JSON output", () =>
        post({ type: "chooseFile", purpose: "jsonOutput" }),
      ),
      button("Add native CSV output", () =>
        post({ type: "chooseFile", purpose: "csvOutput" }),
      ),
      node(
        "p",
        "Choose a new file path. Existing files are rejected to prevent accidental overwrites. External output choices appear only for the tested k6 v2.3.x capability profile. Other binaries remain script-first.",
      ),
    );
    const external = config.externalOutput;
    outputs.append(
      field(
        "External destination",
        external?.kind ?? "none",
        (value) => {
          if (value === "none") delete config.externalOutput;
          else
            config.externalOutput = {
              kind: value as "influxdb" | "experimental-prometheus-rw",
              endpoint: "http://localhost:8086/loaddeck",
              usernameVariable: "",
              passwordVariable: "",
              enabled: true,
            };
          render();
        },
        ["none", ...availableOutputs],
      ),
    );
    if (external) {
      outputs.append(
        field(
          "Enable metrics egress",
          external.enabled,
          (v) => (external.enabled = v === "true"),
        ),
        field(
          "Output endpoint",
          external.endpoint,
          (v) => (external.endpoint = v),
        ),
        field(
          "Output username variable (optional)",
          external.usernameVariable,
          (v) => (external.usernameVariable = v),
        ),
        field(
          "Output password variable (optional)",
          external.passwordVariable,
          (v) => (external.passwordVariable = v),
        ),
        button("Store output username", () =>
          post({ type: "credential", name: external.usernameVariable }),
        ),
        button("Store output password", () =>
          post({ type: "credential", name: external.passwordVariable }),
        ),
        node(
          "p",
          "Metrics leave your machine when enabled. InfluxDB requires a v1-compatible backend; Prometheus requires remote-write enabled. Custom xk6 and Grafana Cloud outputs remain script-first.",
        ),
      );
    }
    if (!requestOnly) root.append(outputs);
    for (const detail of root.querySelectorAll("details"))
      if (opened.has(detail.querySelector("summary")?.textContent))
        detail.open = true;
  }
  render();
  root.addEventListener("refreshBuilder", render);
  return root;
}
