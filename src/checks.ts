export interface CheckRule {
  name: string;
  kind:
    | "status"
    | "statuses"
    | "bodyRegex"
    | "headerRegex"
    | "messageRegex"
    | "bodyBytes"
    | "duration"
    | "bodyContains"
    | "bodyNonempty"
    | "jsonEquals"
    | "headerEquals"
    | "headerExists"
    | "bodyLength"
    | "messageContains"
    | "grpcStatus";
  value: string;
  flags?: string;
  group?: string;
  tags?: Record<string, string>;
  scenarios?: string[];
  path: string;
  enabled: boolean;
}
export function validateChecks(rules: CheckRule[]): void {
  if (!Array.isArray(rules) || rules.length > 100)
    throw new Error("Configure at most 100 checks.");
  const names = new Set<string>();
  for (const rule of rules) {
    if (!rule.name || rule.name.length > 120 || names.has(rule.name))
      throw new Error("Check names must be unique and nonempty.");
    names.add(rule.name);
    if (
      ![
        "status",
        "statuses",
        "bodyRegex",
        "headerRegex",
        "messageRegex",
        "bodyBytes",
        "duration",
        "bodyContains",
        "bodyNonempty",
        "jsonEquals",
        "headerEquals",
        "headerExists",
        "bodyLength",
        "messageContains",
        "grpcStatus",
      ].includes(rule.kind)
    )
      throw new Error("Unsupported check kind.");
    if (typeof rule.value !== "string" || typeof rule.path !== "string")
      throw new Error("Invalid check value.");
    if (
      ["duration", "status", "grpcStatus", "bodyLength", "bodyBytes"].includes(
        rule.kind,
      ) &&
      !/^\d+(\.\d+)?$/.test(rule.value)
    )
      throw new Error("This check requires a nonnegative numeric value.");
    if (
      rule.kind === "status" &&
      (!Number.isInteger(Number(rule.value)) ||
        Number(rule.value) < 100 ||
        Number(rule.value) > 599)
    )
      throw new Error("HTTP status must be an integer from 100 to 599.");
    if (
      rule.kind === "grpcStatus" &&
      (!Number.isInteger(Number(rule.value)) || Number(rule.value) > 16)
    )
      throw new Error("gRPC status must be an integer from 0 to 16.");
    if (rule.kind === "statuses") parseStatuses(rule.value);
    if (["bodyRegex", "headerRegex", "messageRegex"].includes(rule.kind)) {
      if (
        !rule.value ||
        rule.value.length > 512 ||
        !/^(?!.*(.).*\1)[imsu]*$/.test(rule.flags ?? "")
      )
        throw new Error(
          "Regular expressions require a pattern up to 512 characters and unique i, m, s or u flags.",
        );
      try {
        new RegExp(rule.value, rule.flags ?? "");
      } catch {
        throw new Error("Enter a valid regular expression.");
      }
    }
    if (
      rule.group !== undefined &&
      (typeof rule.group !== "string" ||
        rule.group.length > 120 ||
        rule.group.includes("::"))
    )
      throw new Error(
        "Check group must be a name up to 120 characters without ::.",
      );
    if (
      rule.tags !== undefined &&
      (!rule.tags ||
        typeof rule.tags !== "object" ||
        Array.isArray(rule.tags) ||
        Object.keys(rule.tags).length > 20 ||
        Object.entries(rule.tags).some(
          ([key, value]) =>
            !/^[-A-Za-z0-9_]{1,80}$/.test(key) ||
            typeof value !== "string" ||
            value.length > 256 ||
            ["check", "group", "scenario", "request", "name"].includes(key) ||
            /token|password|secret|authorization|cookie/i.test(key),
        ))
    )
      throw new Error("Check tags must contain nonsecret string values.");
    if (
      rule.scenarios !== undefined &&
      (!Array.isArray(rule.scenarios) ||
        rule.scenarios.some(
          (name) =>
            typeof name !== "string" ||
            !/^[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(name),
        ))
    )
      throw new Error(
        "Check scenario filters must contain valid scenario names.",
      );
    if (rule.kind === "jsonEquals") {
      if (!/^[A-Za-z0-9_.]+$/.test(rule.path))
        throw new Error("JSON path: use dot-separated keys.");
      try {
        JSON.parse(rule.value);
      } catch {
        throw new Error("JSON expected value must be valid JSON.");
      }
    }
  }
}
export function checkExpression(rule: CheckRule, protocol: string): string {
  const val = JSON.stringify(rule.value),
    key = JSON.stringify(rule.path);
  switch (rule.kind) {
    case "status":
      return `r.status === ${Number(rule.value)}`;
    case "statuses":
      return `${JSON.stringify(parseStatuses(rule.value))}.includes(r.status)`;
    case "bodyBytes":
      return `typeof r.body === 'string' && utf8Length(r.body) >= ${Number(rule.value)}`;
    case "bodyRegex":
    case "messageRegex":
      return `new RegExp(${val}, ${JSON.stringify(rule.flags ?? "")}).test(String(${protocol === "ws" ? "r" : "r.body"} ?? ''))`;
    case "headerRegex":
      return `headerValue(r, ${key}) !== undefined && new RegExp(${val}, ${JSON.stringify(rule.flags ?? "")}).test(String(headerValue(r, ${key})))`;
    case "grpcStatus":
      return `Number(r.status) === ${Number(rule.value)}`;
    case "duration":
      return `r.timings.duration < ${Number(rule.value)}`;
    case "bodyContains":
    case "messageContains":
      return `String(${protocol === "ws" ? "r" : "r.body"} || '').includes(${val})`;
    case "bodyNonempty":
      return `Boolean(r.body && r.body.length)`;
    case "bodyLength":
      return `typeof r.body === 'string' && r.body.length >= ${Number(rule.value)}`;
    case "headerExists":
      return `headerValue(r, ${key}) !== undefined`;
    case "headerEquals":
      return `headerValue(r, ${key}) !== undefined && String(headerValue(r, ${key})) === ${val}`;
    case "jsonEquals":
      return `JSON.stringify(jsonPath(${protocol === "grpc" ? "r.message" : "r.json()"}, ${key})) === ${JSON.stringify(JSON.stringify(JSON.parse(rule.value)))}`;
  }
}

export function parseStatuses(value: string): number[] {
  if (
    typeof value !== "string" ||
    !/^\s*\d{3}(?:\s*,\s*\d{3})*\s*$/.test(value)
  )
    throw new Error(
      "Allowed statuses must be comma-separated HTTP status codes.",
    );
  const statuses = [
    ...new Set(value.split(",").map((item) => Number(item.trim()))),
  ];
  if (statuses.some((status) => status < 100 || status > 599))
    throw new Error("Allowed statuses must be between 100 and 599.");
  return statuses;
}
export function checkStatements(
  rules: CheckRule[],
  protocol: string,
  scenario: string,
  value = "response",
  options: { missingResponse?: boolean } = {},
): string {
  return rules
    .filter(
      (rule) =>
        rule.enabled &&
        (!rule.scenarios?.length || rule.scenarios.includes(scenario)),
    )
    .map((rule) => {
      const predicate = options.missingResponse
        ? "() => false"
        : `r => safeCheck(() => ${checkExpression(rule, protocol)})`;
      const check = `check(${value}, { ${JSON.stringify(rule.name)}: ${predicate} }, ${JSON.stringify({ ...rule.tags, request: scenario })});`;
      return rule.group
        ? `group(${JSON.stringify(rule.group)}, () => { ${check} });`
        : check;
    })
    .join("\n  ");
}

export function checkKinds(protocol: string): CheckRule["kind"][] {
  if (protocol === "ws") return ["messageContains", "messageRegex"];
  if (protocol === "grpc") return ["grpcStatus", "jsonEquals"];
  return [
    "status",
    "statuses",
    "duration",
    "bodyContains",
    "bodyRegex",
    "bodyNonempty",
    "jsonEquals",
    "headerEquals",
    "headerRegex",
    "headerExists",
    "bodyLength",
    "bodyBytes",
  ];
}
