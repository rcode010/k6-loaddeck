import { loadSync, type ServiceDefinition } from "@grpc/proto-loader";
import { stat } from "node:fs/promises";
import path from "node:path";

export async function protoMethods(
  file: string,
  importPaths: string[] = [],
): Promise<string[]> {
  if (!file.endsWith(".proto") || (await stat(file)).size > 20 * 1024 * 1024)
    throw new Error("Select a .proto schema smaller than 20 MiB.");
  const definition = loadSync(file, {
    includeDirs: [...importPaths, path.dirname(file)],
  });
  const methods = Object.values(definition)
    .filter((item) => !("format" in item))
    .flatMap((item) =>
      Object.values(item as ServiceDefinition)
        .filter((method) => !method.requestStream && !method.responseStream)
        .map((method) => method.path.replace(/^\//, "")),
    );
  if (!methods.length)
    throw new Error(
      "The schema has no unary gRPC methods. Streaming calls remain script-first.",
    );
  return [...new Set(methods)].sort();
}
