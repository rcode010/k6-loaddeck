import {
  thresholdOptions,
  configuredThresholds,
  parseThreshold,
} from "./thresholds";
import path from "node:path";
import type { QuickTest } from "./model";
import { scenarioConfig } from "./requests";
import { dataRuntime } from "./data";
import { defaultScenario, scenarioOptions, checkStatements } from "./workload";
const json = JSON.stringify;
export function generateScript(
  c: QuickTest,
  secretNames: string[] = [],
): string {
  const scenarios = (c.scenarios ?? [defaultScenario(c)]).filter(
    (s) => s.enabled,
  );
  const requests = scenarios.map((s) => scenarioConfig(c, s));
  const options = {
    scenarios: Object.fromEntries(
      scenarios.map((s, i) => [s.name, scenarioOptions(s, i)]),
    ),
    thresholds: thresholdOptions(c),
    summaryTrendStats: [
      ...new Set([
        "avg",
        "min",
        "max",
        "med",
        "p(95)",
        "p(99)",
        ...configuredThresholds(c)
          .filter((d) => d.metricType === "trend")
          .map((d) => parseThreshold(d.expression).aggregation),
      ]),
    ],
    systemTags: [
      "status",
      "method",
      "name",
      "scenario",
      "group",
      "check",
      "expected_response",
      "proto",
    ],
  };
  const imports = [
    "import http from 'k6/http';",
    "import { check, sleep, group } from 'k6';",
    "import encoding from 'k6/encoding';",
    "import exec from 'k6/execution';",
  ];
  if (secretNames.length) imports.push("import secrets from 'k6/secrets';");
  if (requests.some((r) => r.protocol?.kind === "ws"))
    imports.push("import ws from 'k6/ws';");
  if (requests.some((r) => r.protocol?.kind === "grpc"))
    imports.push("import grpc from 'k6/net/grpc';");
  if (requests.some((r) => r.dataset?.file))
    imports.push("import { SharedArray } from 'k6/data';");
  let init = `export const options = ${json(options, null, 2).replaceAll('"__proto__":', '["__proto__"]:')};\n`;
  const certificates = requests.filter(
    (r) => r.authentication?.mode === "mtls" && r.protocol?.kind !== "grpc",
  );
  if (certificates.length)
    init += `options.tlsAuth = [${certificates.map((r) => `{ domains: [${json(new URL(r.url).hostname)}], cert: required(${json(r.authentication!.certificateVariable)}), key: required(${json(r.authentication!.privateKeyVariable)}) }`).join(",")}];\n`;
  for (const [index, r] of requests.entries()) {
    if (r.dataset?.file)
      init += `const rows_${index} = new SharedArray(${json("LoadDeck dataset " + index)}, () => ${r.dataset.format === "json" ? `JSON.parse(open(${json(r.dataset.file)}))` : `parseCsv(open(${json(r.dataset.file)}))`}.map(row => dataRow(row, JSON.parse(${json(json(r.dataset.types ?? {}))}))));\n`;
    if (r.bodyMode === "multipart" && r.upload)
      init += `const uploadData_${index} = open(${json(r.upload.path)}, 'b');\n`;
    if (r.protocol?.kind === "grpc")
      init += `const client_${index} = new grpc.Client();\nclient_${index}.load(${json([...r.protocol.importPaths, path.dirname(r.protocol.protoFile)])}, ${json(path.basename(r.protocol.protoFile))});\n`;
  }
  const helper = `${secretNames.length ? `const protectedValues = Object.create(null); let protectedReady = false;\nasync function loadProtected() { if (protectedReady) return; for (const name of ${json(secretNames)}) protectedValues[name] = await secrets.get(name); protectedReady = true; }\n` : ""}function required(name) { const value = ${secretNames.length ? "protectedValues[name] || " : ""}__ENV[name]; if (!value) throw new Error('Missing runtime variable: ' + name); return value; }
function safeCheck(fn) { try { return Boolean(fn()); } catch { return false; } }
function headerValue(response, name) { const headers = response.headers || {}; const key = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase()); return key === undefined ? undefined : headers[key]; }
function utf8Length(value) { let bytes = 0; for (let index = 0; index < value.length; index++) { const point = value.codePointAt(index); bytes += point <= 127 ? 1 : point <= 2047 ? 2 : point <= 65535 ? 3 : 4; if (point > 65535) index++; } return bytes; }
function jsonPath(value, path) { return path.split('.').reduce((v, key) => v !== null && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, key) ? v[key] : undefined, value); }
function template(value, row) { return String(value).replace(/\\$\\{([A-Z_][A-Z0-9_]*)\\}/g, (_, key) => required(key)).replace(/\\{\\{([A-Za-z0-9_.]+)\\}\\}/g, (_, key) => { const found = jsonPath(row, key); if (found === undefined) throw new Error('Missing dataset column: ' + key); return String(found); }); }
function jsonTemplate(value, row) { if (Array.isArray(value)) return value.map(v => jsonTemplate(v, row)); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,jsonTemplate(v,row)])); if (typeof value === 'string') { const match = /^\\{\\{([A-Za-z0-9_.]+)\\}\\}$/.exec(value); return match ? jsonPath(row, match[1]) : template(value,row); } return value; }
const oauthTokens = Object.create(null);
function oauth(id, url, username, secret, scope, audience) { const cached = oauthTokens[id]; if (cached && Date.now() < cached.expiry) return cached.token; const response = http.post(url, { grant_type: 'client_credentials', client_id: required(username), client_secret: required(secret), scope, audience }, {tags:{name:'OAuth token'}}); if (response.status !== 200) throw new Error('OAuth token acquisition failed'); const payload = response.json(); if (!payload.access_token) throw new Error('OAuth response has no access token'); oauthTokens[id] = { token: payload.access_token, expiry: Date.now() + Math.max(1, Number(payload.expires_in || 60) - 5) * 1000 }; return payload.access_token; }
`;
  const csvHelper = requests.some((r) => r.dataset?.format === "csv")
    ? `function parseCsv(text) { const rows=[]; let row=[],cell='',quoted=false; for(let i=0;i<text.length;i++){const ch=text[i]; if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell);cell='';}else if((ch==='\\n'||ch==='\\r')&&!quoted){if(ch==='\\r'&&text[i+1]==='\\n')i++;row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';}else cell+=ch;} if(cell||row.length){row.push(cell);rows.push(row);} const headers=rows.shift();return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]]))); }\n`
    : "";
  const functions = scenarios
    .map((s, index) => {
      const c = requests[index]!;
      const protocol = c.protocol?.kind ?? "http";
      const auth = c.authentication;
      const headers = Object.entries(c.headers)
        .map(
          ([key, value]) =>
            `[${json(key)}]: ${/^\$\{[A-Z_][A-Z0-9_]*\}$/.test(value) ? `required(${json(value.slice(2, -1))})` : `template(${json(value)}, row)`}`,
        )
        .join(", ");
      const rules = [...(c.checks ?? [])];
      if (
        c.expectedStatus !== undefined &&
        ["http", "http2"].includes(protocol)
      )
        rules.push({
          name: `status is ${c.expectedStatus}`,
          kind: "status",
          value: String(c.expectedStatus),
          path: "",
          enabled: true,
        });
      const assertions = checkStatements(rules, protocol, s.name);
      const messageAssertions = checkStatements(
        rules,
        protocol,
        s.name,
        "message",
      );
      let row = `const row = JSON.parse(${json(json(c.dataset?.variables ?? {}))});`;
      if (c.dataset?.file) {
        const strategy = c.dataset.strategy;
        const position =
          strategy === "random"
            ? `Math.floor(Math.random() * rows_${index}.length)`
            : strategy === "per-vu"
              ? "exec.vu.idInTest - 1"
              : "exec.scenario.iterationInTest";
        row = `if (!rows_${index}.length) throw new Error('Dataset is empty');\n  const position = ${position};\n  ${c.dataset.exhaustion === "fail" ? `if (position >= rows_${index}.length) exec.test.abort('Dataset exhausted');` : ""}\n  const row = { ...JSON.parse(${json(json(c.dataset.variables))}), ...rows_${index}[position % rows_${index}.length] };`;
      }
      let setup = `${row}\n  let target = template(${json(c.url)}, row);\n  const headers = Object.assign(Object.create(null), { ${headers} });\n`;
      if (c.bodyMode === "json" && c.body)
        setup += `  if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';\n`;
      if (auth && auth.mode !== "none") {
        const secret = `required(${json(auth.secretVariable)})`;
        if (auth.mode === "basic")
          setup += `  headers.Authorization = 'Basic ' + encoding.b64encode(required(${json(auth.usernameVariable)}) + ':' + ${secret});\n`;
        if (["digest", "ntlm"].includes(auth.mode))
          setup += `  target = target.replace(/^(https?:\\/\\/)/, prefix => prefix + encodeURIComponent(required(${json(auth.usernameVariable)})) + ':' + encodeURIComponent(${secret}) + '@');\n`;
        if (auth.mode === "bearer")
          setup += `  headers.Authorization = 'Bearer ' + ${secret};\n`;
        if (auth.mode === "apiKey")
          setup +=
            auth.placement === "query"
              ? `  target += (target.includes('?') ? '&' : '?') + encodeURIComponent(${json(auth.keyName)}) + '=' + encodeURIComponent(${secret});\n`
              : `  headers[${json(auth.keyName)}] = ${secret};\n`;
        if (auth.mode === "cookie")
          setup += `  headers.Cookie = ${json(auth.keyName + "=")} + ${secret};\n`;
        if (auth.mode === "oauth2")
          setup += `  headers.Authorization = 'Bearer ' + oauth(${index}, ${json(auth.tokenUrl)}, ${json(auth.usernameVariable)}, ${json(auth.secretVariable)}, ${json(auth.scope)}, ${json(auth.audience)});\n`;
      }
      if (c.bodyMode === "form" || c.bodyMode === "multipart") {
        setup += `  const payload = jsonTemplate(JSON.parse(${json(c.body || "{}")}), row);\n`;
        if (c.bodyMode === "multipart" && c.upload)
          setup += `  payload[${json(c.upload.field)}] = http.file(uploadData_${index}, ${json(c.upload.filename)}, ${json(c.upload.contentType)});\n`;
      }
      let operation: string;
      if (protocol === "ws") {
        const absent = checkStatements(rules, protocol, s.name, "null", {
          missingResponse: true,
        });
        const messages = c.protocol!.messages ?? [
          { text: c.protocol!.message, delayMs: 0 },
        ];
        const send = messages
          .map((message) =>
            message.delayMs
              ? `socket.setTimeout(() => socket.send(template(${json(message.text)}, row)), ${message.delayMs});`
              : `socket.send(template(${json(message.text)}, row));`,
          )
          .join(" ");
        operation = `  let receivedMessages = 0, receivedInTime = 0, openedAt = 0;\n  const response = ws.connect(target, { headers, tags:{name:${json(s.name)}} }, socket => {\n    socket.on('open', () => { openedAt = Date.now(); ${send} });\n    socket.on('message', message => { receivedMessages++; if (Date.now() - openedAt <= ${c.protocol!.receiveDeadlineMs ?? c.protocol!.sessionMs}) receivedInTime++; ${messageAssertions} });\n    socket.setTimeout(() => socket.close(), ${c.protocol!.sessionMs});\n  });\n  check(response, {'WebSocket connected': r => r && r.status === 101});\n  ${absent ? `if (receivedMessages === 0) { ${absent} }\n` : ""}${c.protocol!.expectedMessages !== undefined ? `  check(receivedInTime, {'WebSocket receive expectation': count => count >= ${c.protocol!.expectedMessages}});\n` : ""}`;
      } else if (protocol === "grpc")
        operation = `  client_${index}.connect(target.replace(/^grpcs?:\\/\\//, ''), { plaintext: ${c.protocol!.plaintext}, timeout: ${json(c.protocol!.timeout ?? "30s")}${auth?.mode === "mtls" ? `, tls: { cert: required(${json(auth.certificateVariable)}), key: required(${json(auth.privateKeyVariable)}) }` : ""} });\n  try { const response = client_${index}.invoke(${json(c.protocol!.grpcMethod)}, jsonTemplate(JSON.parse(${json(c.protocol!.message)}), row), { metadata:headers, timeout: ${json(c.protocol!.timeout ?? "30s")}, tags:{name:${json(s.name)}} });\n  ${assertions || "check(response, {'gRPC status OK': r => r && r.status === grpc.StatusOK});"}\n  } finally { client_${index}.close(); }\n`;
      else
        operation = `  const response = http.request(${json(c.method)}, target, ${["form", "multipart"].includes(c.bodyMode) ? "payload" : c.body ? (c.bodyMode === "json" ? `JSON.stringify(jsonTemplate(JSON.parse(${json(c.body)}), row))` : `template(${json(c.body)}, row)`) : "null"}, { headers, ${auth && ["digest", "ntlm"].includes(auth.mode) ? `auth:${json(auth.mode)},` : ""}tags:{name:${json(s.name)}}, timeout:${json(c.protocol?.timeout ?? "30s")}, redirects:${c.protocol?.redirects ?? 10} });\n  ${assertions}\n`;
      return `export ${secretNames.length ? "async " : ""}function scenario_${index}() {\n  ${secretNames.length ? "await loadProtected();\n  " : ""}${setup}${operation}${s.executor.includes("arrival-rate") ? "" : `  sleep(${c.sleep});\n`}}`;
    })
    .join("\n\n");
  return `${imports.join("\n")}\n\n${helper}${dataRuntime}${csvHelper}\n${init}\n${functions}\n\nexport default scenario_0;\n\nexport function handleSummary(data) {\n  return __ENV.LOADDECK_SUMMARY ? { [__ENV.LOADDECK_SUMMARY]: JSON.stringify(data) } : { stdout: JSON.stringify(data, null, 2) };\n}\n`;
}
