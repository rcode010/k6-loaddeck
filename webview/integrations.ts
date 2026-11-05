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
    if (p.kind === "ws")
      protocol.append(
        field("Message to send", p.message, (v) => (p.message = v)),
        field(
          "Session duration (ms)",
          p.sessionMs,
          (v) => (p.sessionMs = Number(v)),
        ),
      );
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
        ["none", "basic", "bearer", "apiKey", "cookie", "oauth2", "mtls"],
      ),
    );
    if (a.mode !== "none") {
      if (["basic", "oauth2"].includes(a.mode))
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
        "Digest and NTLM are unavailable in this preview: compatible authentication fixtures have not been validated. Use an existing script for these schemes.",
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
        "Choose a new file path. Existing files are rejected to prevent accidental overwrites. External output backends are unavailable in this preview until binary capability checks and connection fixtures are validated.",
      ),
    );
    root.append(outputs);
    for (const detail of root.querySelectorAll("details"))
      if (opened.has(detail.querySelector("summary")?.textContent))
        detail.open = true;
  }
  render();
  root.addEventListener("refreshBuilder", render);
  return root;
}
