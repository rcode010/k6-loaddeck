import type { MetricDefinition } from "./thresholds";
import type { SavedTest } from "./templates";
import type { ExternalOutput } from "./outputs";
import type {
  ProtocolConfig,
  Authentication,
  Dataset,
  FileOutput,
} from "./integrations";
import type { Scenario, CheckRule, ThresholdRule } from "./workload";
export type TestKind =
  "smoke" | "load" | "stress" | "spike" | "soak" | "custom";
export type RunState =
  | "starting"
  | "running"
  | "stopping"
  | "completed"
  | "threshold_failed"
  | "execution_failed"
  | "cancelled";
export interface QuickTest {
  protocol?: ProtocolConfig;
  authentication?: Authentication;
  dataset?: Dataset;
  outputs?: FileOutput[];
  externalOutput?: ExternalOutput;
  scenarios?: Scenario[];
  checks?: CheckRule[];
  thresholdRules?: ThresholdRule[];
  name: string;
  url: string;
  method: string;
  testKind: Exclude<TestKind, "custom">;
  vus: number;
  duration: string;
  sleep: number;
  headers: Record<string, string>;
  body: string;
  bodyMode: "text" | "json" | "form" | "multipart";
  upload?: {
    path: string;
    field: string;
    filename: string;
    contentType: string;
  };
  expectedStatus?: number;
  thresholds: Record<string, string[]>;
}
export type RequestConfig = Pick<
  QuickTest,
  | "url"
  | "method"
  | "sleep"
  | "headers"
  | "body"
  | "bodyMode"
  | "upload"
  | "expectedStatus"
  | "protocol"
  | "authentication"
  | "dataset"
  | "checks"
>;
export interface Metrics {
  requests?: number;
  rps?: number;
  avg?: number;
  p95?: number;
  p99?: number;
  failureRate?: number;
  vus?: number;
  checksPassed?: number;
  checksFailed?: number;
  droppedIterations?: number;
}
export interface Bucket {
  widthSeconds?: number;
  elapsed: number;
  requests: number;
  latencySum: number;
  latencyCount: number;
  failures: number;
  failureCount: number;
  vus?: number;
}
export interface CheckResult {
  name: string;
  passes: number;
  fails: number;
  group?: string;
  scenario?: string;
  request?: string;
  source?: "observed" | "k6-summary";
}
export interface ThresholdResult {
  metric: string;
  expression: string;
  ok: boolean | null;
  observedValue?: number;
  unit?: string;
  abortOnFail?: boolean;
  delayAbortEval?: string;
}
export interface Run {
  outputs?: {
    kind: string;
    destination: string;
    state: "pending" | "written" | "partial" | "failed" | "unverified";
  }[];
  schemaVersion: 1;
  id: string;
  name: string;
  testKind: TestKind;
  target: string;
  method: string;
  fingerprint: string;
  conditions?: Record<string, string>;
  scriptIdentity?: string;
  scriptDigest?: string;
  scriptReference?: string;
  templateId?: string;
  config?: QuickTest;
  rerunnable: boolean;
  startedAt: string;
  endedAt?: string;
  elapsedMs: number;
  state: RunState;
  exitCode: number | null;
  k6Version: string;
  metricCatalog?: MetricDefinition[];
  thresholdsConfigured?: boolean;
  engineElapsedMs?: number;
  plannedDurationMs?: number;
  observation?:
    | "complete"
    | "cancelled"
    | "threshold-aborted"
    | "threshold-abort-possible"
    | "incomplete";
  protocol?: string;
  credentialSource?: "k6-secret-source" | "environment";
  scenarioMetrics?: Record<string, Metrics>;
  scenarioSeries?: Record<string, Bucket[]>;
  scenarioProtocolMetrics?: Record<string, Record<string, number>>;
  scenarioProtocols?: Record<string, string>;
  protocolMetrics?: Record<string, number>;
  metrics: Metrics;
  series: Bucket[];
  checkResults?: CheckResult[];
  thresholds: ThresholdResult[];
  summarySource: "k6-summary" | "observed";
  logs: string[];
}
export interface Installation {
  ready: boolean;
  version: string;
  error?: string;
  externalOutputs?: string[];
}
export type Screen = "home" | "run" | "history" | "compare" | "saved";
export interface ViewState {
  screen: Screen;
  installation: Installation;
  runs: Run[];
  templates?: SavedTest[];
  active?: Run;
  selected?: Run;
  error?: string;
  defaults: { testKind: "smoke" | "load"; vus: number; duration: string };
}
export type ClientMessage =
  | { type: "ready" | "check" | "runFile" | "logs" | "clear" }
  | { type: "stop"; id: string }
  | { type: "navigate"; screen: Screen }
  | { type: "run" | "save" | "preview" | "saveTemplate"; config: QuickTest }
  | { type: "openTemplate" | "runTemplate" | "deleteTemplate"; id: string }
  | {
      type: "open" | "rerun" | "delete" | "export" | "openScript";
      id: string;
      format?: "json" | "csv" | "html";
    }
  | { type: "credential" | "deleteCredential"; name: string }
  | {
      type: "inspectProto";
      file: string;
      importPaths: string[];
      scenario?: string;
    }
  | {
      type: "chooseFile";
      purpose: "dataset" | "proto" | "jsonOutput" | "csvOutput" | "upload";
      format?: "json" | "csv";
      scenario?: string;
    };
export const defaultTest: QuickTest = {
  name: "",
  url: "",
  method: "GET",
  testKind: "smoke",
  vus: 1,
  duration: "10s",
  sleep: 1,
  headers: {},
  body: "",
  bodyMode: "text",
  thresholds: {},
};
