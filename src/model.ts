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
  elapsed: number;
  requests: number;
  latencySum: number;
  latencyCount: number;
  failures: number;
  failureCount: number;
  vus?: number;
}
export interface ThresholdResult {
  metric: string;
  expression: string;
  ok: boolean;
}
export interface Run {
  schemaVersion: 1;
  id: string;
  name: string;
  testKind: TestKind;
  target: string;
  method: string;
  fingerprint: string;
  conditions?: Record<string, string>;
  scriptIdentity?: string;
  config?: QuickTest;
  rerunnable: boolean;
  startedAt: string;
  endedAt?: string;
  elapsedMs: number;
  state: RunState;
  exitCode: number | null;
  k6Version: string;
  protocol?: string;
  scenarioMetrics?: Record<string, Metrics>;
  protocolMetrics?: Record<string, number>;
  metrics: Metrics;
  series: Bucket[];
  checkResults?: { name: string; passes: number; fails: number }[];
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
export type Screen = "home" | "run" | "history" | "compare";
export interface ViewState {
  screen: Screen;
  installation: Installation;
  runs: Run[];
  active?: Run;
  selected?: Run;
  error?: string;
  defaults: { testKind: "smoke" | "load"; vus: number; duration: string };
}
export type ClientMessage =
  | { type: "ready" | "check" | "runFile" | "logs" | "clear" }
  | { type: "stop"; id: string }
  | { type: "navigate"; screen: Screen }
  | { type: "run" | "save" | "preview"; config: QuickTest }
  | {
      type: "open" | "rerun" | "delete" | "export";
      id: string;
      format?: "json" | "csv" | "html";
    }
  | { type: "credential"; name: string }
  | {
      type: "chooseFile";
      purpose: "dataset" | "proto" | "jsonOutput" | "csvOutput" | "upload";
      format?: "json" | "csv";
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
