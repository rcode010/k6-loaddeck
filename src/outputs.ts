import { verifiedProfile } from "./capabilities";
export interface ExternalOutput {
  kind: "influxdb" | "experimental-prometheus-rw";
  endpoint: string;
  usernameVariable: string;
  passwordVariable: string;
  enabled: boolean;
}
export function externalEnvironment(
  output: ExternalOutput,
  resolve: (name: string) => string | undefined,
): Record<string, string> {
  const url = new URL(output.endpoint);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "External output endpoint must be HTTP(S), without credentials or query parameters.",
    );
  if (!["influxdb", "experimental-prometheus-rw"].includes(output.kind))
    throw new Error("Unsupported external output.");
  const environment: Record<string, string> = {};
  const prefix =
    output.kind === "influxdb" ? "K6_INFLUXDB_" : "K6_PROMETHEUS_RW_";
  if (output.kind === "experimental-prometheus-rw")
    environment.K6_PROMETHEUS_RW_SERVER_URL = output.endpoint;
  for (const [name, suffix] of [
    [
      output.usernameVariable,
      output.kind === "influxdb" ? "USERNAME" : "USERNAME",
    ],
    [
      output.passwordVariable,
      output.kind === "influxdb" ? "PASSWORD" : "PASSWORD",
    ],
  ])
    if (name) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(name))
        throw new Error(
          "External credentials must reference runtime variable names.",
        );
      const value = resolve(name);
      if (!value) throw new Error(`Missing output credential: ${name}`);
      environment[prefix + suffix] = value;
    }
  return environment;
}
export function supportedExternalOutputs(version: string): string[] {
  return verifiedProfile(version)
    ? ["influxdb", "experimental-prometheus-rw"]
    : [];
}
