import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { verifiedProfile } from "./capabilities";

export function supportsScenarioSelection(version: string): boolean {
  return verifiedProfile(version);
}
export async function inspectScenarios(
  binary: string,
  file: string,
  environment: Record<string, string> = {},
): Promise<string[]> {
  try {
    const result = await promisify(execFile)(
      binary,
      [
        "inspect",
        "--execution-requirements",
        "--include-system-env-vars",
        file,
      ],
      {
        cwd: path.dirname(file),
        env: { ...process.env, ...environment, K6_NO_USAGE_REPORT: "true" },
        timeout: 10000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const options = JSON.parse(result.stdout);
    const names = Object.keys(options.scenarios ?? {});
    if (names.some((name) => /[,\r\n\0]/.test(name)))
      throw new Error(
        "Scenario names cannot contain commas or control characters for selection.",
      );
    return names;
  } catch {
    throw new Error(
      "Unable to inspect this script safely. Check its imports/options or use Run Test File to preserve all original scenarios. Inspection diagnostics may contain sensitive script output and are not displayed.",
    );
  }
}
