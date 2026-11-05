import path from "node:path";
import type { QuickTest } from "./model";
import {
  defaultScenario,
  scenarioOptions,
  compileThresholds,
  checkStatements,
} from "./workload";
const json = JSON.stringify;
export function generateScript(c: QuickTest): string {
  const protocol = c.protocol?.kind ?? "http";
  const scenarios = (c.scenarios ?? [defaultScenario(c)]).filter(
    (s) => s.enabled,
  );
  const auth = c.authentication;
  const headers = Object.entries(c.headers)
    .map(
      ([key, value]) =>
        `${json(key)}: ${/^\$\{[A-Z_][A-Z0-9_]*\}$/.test(value) ? `required(${json(value.slice(2, -1))})` : `template(${json(value)}, row)`}`,
    )
    .join(", ");
  const options = {
    scenarios: Object.fromEntries(
      scenarios.map((s, i) => [s.name, scenarioOptions(s, i)]),
    ),
    thresholds: {
      ...c.thresholds,
      ...compileThresholds(c.thresholdRules ?? []),
    },
    summaryTrendStats: ["avg", "min", "max", "med", "p(95)", "p(99)"],
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
  const rules = [...(c.checks ?? [])];
  if (c.expectedStatus !== undefined && ["http", "http2"].includes(protocol))
    rules.push({
      name: `status is ${c.expectedStatus}`,
      kind: "status",
      value: String(c.expectedStatus),
      path: "",
      enabled: true,
    });
  const imports = [
    "import http from 'k6/http';",
    "import { check, sleep, group } from 'k6';",
    "import encoding from 'k6/encoding';",
    "import exec from 'k6/execution';",
  ];
  if (protocol === "ws") imports.push("import ws from 'k6/ws';");
  if (protocol === "grpc") imports.push("import grpc from 'k6/net/grpc';");
  if (c.dataset?.file) imports.push("import { SharedArray } from 'k6/data';");
  let init = `export const options = ${json(options, null, 2)};\n`;
  if (auth?.mode === "mtls")
    init += `options.tlsAuth = [{ cert: required(${json(auth.certificateVariable)}), key: required(${json(auth.privateKeyVariable)}) }];\n`;
  if (c.dataset?.file)
    init += `const rows = new SharedArray('LoadDeck dataset', () => ${c.dataset.format === "json" ? `JSON.parse(open(${json(c.dataset.file)}))` : `parseCsv(open(${json(c.dataset.file)}))`});\n`;
  if (c.bodyMode === "multipart" && c.upload)
    init += `const uploadData = open(${json(c.upload.path)}, 'b');\n`;
  if (protocol === "grpc")
    init += `const client = new grpc.Client();\nclient.load(${json([...c.protocol!.importPaths, path.dirname(c.protocol!.protoFile)])}, ${json(path.basename(c.protocol!.protoFile))});\n`;
  const helper = `function required(name) { const value = __ENV[name]; if (!value) throw new Error('Missing runtime variable: ' + name); return value; }
function safeCheck(fn) { try { return Boolean(fn()); } catch { return false; } }
function headerValue(response, name) { const headers = response.headers || {}; const key = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase()); return key === undefined ? undefined : headers[key]; }
function utf8Length(value) { let bytes = 0; for (let index = 0; index < value.length; index++) { const point = value.codePointAt(index); bytes += point <= 127 ? 1 : point <= 2047 ? 2 : point <= 65535 ? 3 : 4; if (point > 65535) index++; } return bytes; }
function jsonPath(value, path) { return path.split('.').reduce((v, key) => v == null ? undefined : v[key], value); }
function template(value, row) { return String(value).replace(/\\$\\{([A-Z_][A-Z0-9_]*)\\}/g, (_, key) => required(key)).replace(/\\{\\{([A-Za-z0-9_.]+)\\}\\}/g, (_, key) => { const found = jsonPath(row, key); if (found === undefined) throw new Error('Missing dataset column: ' + key); return String(found); }); }
function jsonTemplate(value, row) { if (Array.isArray(value)) return value.map(v => jsonTemplate(v, row)); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,jsonTemplate(v,row)])); if (typeof value === 'string') { const match = /^\\{\\{([A-Za-z0-9_.]+)\\}\\}$/.exec(value); return match ? jsonPath(row, match[1]) : template(value,row); } return value; }
let oauthToken = ''; let tokenExpiry = 0;
function oauth() { if (Date.now() < tokenExpiry) return oauthToken; const response = http.post(${json(auth?.tokenUrl ?? "")}, { grant_type: 'client_credentials', client_id: ${auth?.mode === "oauth2" ? `required(${json(auth.usernameVariable)})` : "''"}, client_secret: ${auth?.mode === "oauth2" ? `required(${json(auth.secretVariable)})` : "''"}, scope: ${json(auth?.scope ?? "")}, audience: ${json(auth?.audience ?? "")} }, {tags:{name:'OAuth token'}}); if (response.status !== 200) throw new Error('OAuth token acquisition failed'); const payload = response.json(); if (!payload.access_token) throw new Error('OAuth response has no access token'); oauthToken = payload.access_token; tokenExpiry = Date.now() + Math.max(1, Number(payload.expires_in || 60) - 5) * 1000; return oauthToken; }
`;
  const csvHelper =
    c.dataset?.format === "csv"
      ? `function parseCsv(text) { const rows=[]; let row=[],cell='',quoted=false; for(let i=0;i<text.length;i++){const ch=text[i]; if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell);cell='';}else if((ch==='\\n'||ch==='\\r')&&!quoted){if(ch==='\\r'&&text[i+1]==='\\n')i++;row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';}else cell+=ch;} if(cell||row.length){row.push(cell);rows.push(row);} const headers=rows.shift();return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]]))); }\n`
      : "";
  const functions = scenarios
    .map((s, index) => {
      const assertions = checkStatements(rules, protocol, s.name);
      const messageAssertions = checkStatements(
        rules,
        protocol,
        s.name,
        "message",
      );
      let row = `const row = ${json(c.dataset?.variables ?? {})};`;
      if (c.dataset?.file) {
        const strategy = c.dataset.strategy;
        const position =
          strategy === "random"
            ? "Math.floor(Math.random() * rows.length)"
            : strategy === "per-vu"
              ? "exec.vu.idInTest - 1"
              : "exec.scenario.iterationInTest";
        row = `if (!rows.length) throw new Error('Dataset is empty');\n  const position = ${position};\n  ${c.dataset.exhaustion === "fail" ? "if (position >= rows.length) throw new Error('Dataset exhausted');" : ""}\n  const row = Object.assign({}, ${json(c.dataset.variables)}, rows[position % rows.length]);`;
      }
      let setup = `${row}\n  let target = template(${json(s.url || c.url)}, row);\n  const headers = { ${headers} };\n`;
      if (c.bodyMode === "json" && c.body)
        setup += `  if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';\n`;
      if (auth && auth.mode !== "none") {
        const secret = `required(${json(auth.secretVariable)})`;
        if (auth.mode === "basic")
          setup += `  headers.Authorization = 'Basic ' + encoding.b64encode(required(${json(auth.usernameVariable)}) + ':' + ${secret});\n`;
        if (auth.mode === "digest")
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
          setup += `  headers.Authorization = 'Bearer ' + oauth();\n`;
      }
      if (c.bodyMode === "form" || c.bodyMode === "multipart") {
        setup += `  const payload = jsonTemplate(${c.body || "{}"}, row);\n`;
        if (c.bodyMode === "multipart" && c.upload)
          setup += `  payload[${json(c.upload.field)}] = http.file(uploadData, ${json(c.upload.filename)}, ${json(c.upload.contentType)});\n`;
      }
      let operation: string;
      if (protocol === "ws")
        operation = `  const response = ws.connect(target, { headers, tags:{name:${json(s.name)}} }, socket => {\n    socket.on('open', () => socket.send(template(${json(c.protocol!.message)}, row)));\n    socket.on('message', message => { ${messageAssertions} });\n    socket.setTimeout(() => socket.close(), ${c.protocol!.sessionMs});\n  });\n  check(response, {'WebSocket connected': r => r && r.status === 101});\n`;
      else if (protocol === "grpc")
        operation = `  client.connect(target.replace(/^grpcs?:\\/\\//, ''), { plaintext: ${c.protocol!.plaintext} });\n  try { const response = client.invoke(${json(c.protocol!.grpcMethod)}, jsonTemplate(${c.protocol!.message}, row), { metadata:headers, tags:{name:${json(s.name)}} });\n  ${assertions || "check(response, {'gRPC status OK': r => r && r.status === grpc.StatusOK});"}\n  } finally { client.close(); }\n`;
      else
        operation = `  const response = http.request(${json(c.method)}, target, ${["form", "multipart"].includes(c.bodyMode) ? "payload" : c.body ? (c.bodyMode === "json" ? `JSON.stringify(jsonTemplate(${c.body}, row))` : `template(${json(c.body)}, row)`) : "null"}, { headers, ${auth?.mode === "digest" ? "auth:'digest'," : ""}tags:{name:${json(s.name)}}, timeout:'30s' });\n  ${assertions}\n`;
      return `export function scenario_${index}() {\n  ${setup}${operation}${s.executor.includes("arrival-rate") ? "" : `  sleep(${c.sleep});\n`}}`;
    })
    .join("\n\n");
  return `${imports.join("\n")}\n\n${init}\n${helper}${csvHelper}\n${functions}\n\nexport default scenario_0;\n\nexport function handleSummary(data) {\n  return __ENV.LOADDECK_SUMMARY ? { [__ENV.LOADDECK_SUMMARY]: JSON.stringify(data) } : { stdout: JSON.stringify(data, null, 2) };\n}\n`;
}
