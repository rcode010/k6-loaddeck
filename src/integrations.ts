import { checkKinds } from "./checks";
import type { QuickTest } from "./model";
export interface ProtocolConfig {
  kind: "http" | "http2" | "ws" | "grpc";
  message: string;
  sessionMs: number;
  grpcMethod: string;
  protoFile: string;
  importPaths: string[];
  plaintext: boolean;
}
export interface Authentication {
  mode:
    | "none"
    | "basic"
    | "digest"
    | "bearer"
    | "apiKey"
    | "cookie"
    | "oauth2"
    | "mtls";
  usernameVariable: string;
  secretVariable: string;
  keyName: string;
  placement: "header" | "query";
  tokenUrl: string;
  scope: string;
  audience: string;
  certificateVariable: string;
  privateKeyVariable: string;
}
export interface Dataset {
  file: string;
  format: "json" | "csv";
  strategy: "round-robin" | "random" | "per-vu" | "unique";
  exhaustion: "repeat" | "fail";
  variables: Record<string, string>;
}
export interface FileOutput {
  format: "json" | "csv";
  path: string;
}
export function validateIntegrations(c: QuickTest): void {
  if (c.bodyMode === "form" || c.bodyMode === "multipart") {
    const fields = JSON.parse(c.body || "{}");
    if (
      !fields ||
      typeof fields !== "object" ||
      Array.isArray(fields) ||
      Object.values(fields).some((v) => typeof v !== "string")
    )
      throw new Error("Form fields must be a JSON object of string values.");
    if (
      c.bodyMode === "multipart" &&
      (!c.upload?.path ||
        !c.upload.field ||
        !c.upload.filename ||
        !c.upload.contentType)
    )
      throw new Error(
        "Multipart requires a selected file, field name, filename and content type.",
      );
  }
  const p = c.protocol;
  if (p) {
    if (!["http", "http2", "ws", "grpc"].includes(p.kind))
      throw new Error("Select a supported protocol.");
    const url = new URL(c.url);
    const protocols =
      p.kind === "ws"
        ? ["ws:", "wss:"]
        : p.kind === "grpc"
          ? ["grpc:", "grpcs:"]
          : ["http:", "https:"];
    if (!protocols.includes(url.protocol))
      throw new Error(`URL scheme must match ${p.kind}.`);
    if (
      p.kind === "ws" &&
      (!Number.isInteger(p.sessionMs) ||
        p.sessionMs < 100 ||
        p.sessionMs > 300000)
    )
      throw new Error("WebSocket session: use 100–300000 milliseconds.");
    if (p.kind === "grpc") {
      if (
        !/^\/?[A-Za-z_][\w.]*\/[A-Za-z_]\w*$/.test(p.grpcMethod) ||
        !p.protoFile.endsWith(".proto") ||
        !Array.isArray(p.importPaths)
      )
        throw new Error(
          "gRPC: choose a .proto file and package.Service/Method.",
        );
      try {
        JSON.parse(p.message);
      } catch {
        throw new Error("gRPC request message must be valid JSON.");
      }
      if (p.plaintext !== (url.protocol === "grpc:"))
        throw new Error("Use grpc:// for plaintext or grpcs:// for TLS.");
    }
  }
  for (const check of c.checks ?? []) {
    const kind = p?.kind ?? "http";
    const allowed = checkKinds(kind);
    if (check.enabled && !allowed.includes(check.kind))
      throw new Error(`Check ${check.name} is not applicable to ${kind}.`);
  }
  if (c.scenarios)
    for (const scenario of c.scenarios) {
      const target = new URL(scenario.url || c.url);
      const base = new URL(c.url);
      if (target.protocol !== base.protocol)
        throw new Error(
          "Scenario target scheme must match the selected protocol.",
        );
    }
  const auth = c.authentication;
  if (auth && auth.mode !== "none") {
    if (
      ![
        "basic",
        "digest",
        "bearer",
        "apiKey",
        "cookie",
        "oauth2",
        "mtls",
      ].includes(auth.mode)
    )
      throw new Error(
        "Authentication mode is unavailable. NTLM requires separate compatible-environment validation.",
      );
    const variable = (v: string) => {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(v))
        throw new Error(
          "Credentials must reference uppercase environment or protected-storage variable names.",
        );
    };
    if (auth.mode === "mtls") {
      variable(auth.certificateVariable);
      variable(auth.privateKeyVariable);
      if (p?.kind === "grpc" || p?.kind === "ws")
        throw new Error("mTLS builder currently supports HTTP only.");
    } else variable(auth.secretVariable);
    if (["basic", "digest", "oauth2"].includes(auth.mode))
      variable(auth.usernameVariable);
    if (
      (auth.mode === "apiKey" || auth.mode === "cookie") &&
      !/^[A-Za-z0-9_-]+$/.test(auth.keyName)
    )
      throw new Error("Enter a valid API key or cookie name.");
    if (auth.mode === "oauth2") {
      const token = new URL(auth.tokenUrl);
      if (
        !["http:", "https:"].includes(token.protocol) ||
        token.username ||
        token.password
      )
        throw new Error(
          "OAuth token endpoint must be HTTP(S) without embedded credentials.",
        );
    }
    if (p?.kind === "grpc" && !["bearer", "apiKey"].includes(auth.mode))
      throw new Error(
        "gRPC supports Bearer and header API keys in this builder.",
      );
    if (
      p?.kind === "grpc" &&
      auth.mode === "apiKey" &&
      auth.placement === "query"
    )
      throw new Error("gRPC API keys must use metadata headers.");
  }
  if (c.dataset) {
    const d = c.dataset;
    if (
      !["json", "csv"].includes(d.format) ||
      !["round-robin", "random", "per-vu", "unique"].includes(d.strategy) ||
      !["repeat", "fail"].includes(d.exhaustion) ||
      typeof d.file !== "string"
    )
      throw new Error("Invalid dataset configuration.");
    if (
      !d.variables ||
      Object.values(d.variables).some((v) => typeof v !== "string")
    )
      throw new Error("Dataset variables must have string values.");
  }
  if (c.outputs) {
    if (!Array.isArray(c.outputs) || c.outputs.length > 4)
      throw new Error("Configure at most four file outputs.");
    const paths = new Set<string>();
    for (const output of c.outputs) {
      if (
        !["json", "csv"].includes(output.format) ||
        typeof output.path !== "string" ||
        !output.path ||
        /[\r\n\0]/.test(output.path) ||
        paths.has(output.path)
      )
        throw new Error(
          "Output paths must be unique, valid JSON or CSV destinations.",
        );
      paths.add(output.path);
    }
  }
}
export function credentialVariables(c: QuickTest): string[] {
  const a = c.authentication;
  const urlVariables = [
    c.url,
    ...(c.scenarios ?? []).map((s) => s.url),
  ].flatMap((value) =>
    [...value.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map((match) => match[1]!),
  );
  const list = Object.values(c.headers).flatMap((v) =>
    /^\$\{[A-Z_][A-Z0-9_]*\}$/.test(v) ? [v.slice(2, -1)] : [],
  );
  if (a && a.mode !== "none") {
    if (a.mode === "mtls")
      list.push(a.certificateVariable, a.privateKeyVariable);
    else list.push(a.secretVariable);
    if (["basic", "digest", "oauth2"].includes(a.mode))
      list.push(a.usernameVariable);
  }
  if (c.externalOutput?.enabled)
    list.push(
      ...[
        c.externalOutput.usernameVariable,
        c.externalOutput.passwordVariable,
      ].filter(Boolean),
    );
  return [...new Set([...list, ...urlVariables])];
}
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || cell === "") quoted = !quoted;
      else throw new Error("Invalid CSV quote.");
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift();
  if (
    !headers?.length ||
    new Set(headers).size !== headers.length ||
    headers.some((h) => !h)
  )
    throw new Error("CSV requires unique, nonempty column headers.");
  return rows.map((values) => {
    if (values.length !== headers.length)
      throw new Error("CSV row does not match header length.");
    return Object.fromEntries(headers.map((h, i) => [h, values[i]!]));
  });
}
