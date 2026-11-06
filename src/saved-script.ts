import {
  mkdtemp,
  copyFile,
  mkdir,
  readdir,
  stat,
  chmod,
  rm,
  readFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import type { QuickTest } from "./model";
import { generateScript } from "./generator";
import { datasetRows } from "./data";

export async function savedScript(
  config: QuickTest,
  file: string,
): Promise<{ source: string; assets?: string }> {
  const c = structuredClone(config);
  const requests = [
    c,
    ...(c.scenarios ?? []).flatMap((s) => (s.request ? [s.request] : [])),
  ];
  if (
    !requests.some(
      (r) => r.dataset?.file || r.upload || r.protocol?.kind === "grpc",
    )
  )
    return { source: generateScript(c) };
  const directory = await mkdtemp(
    path.join(
      path.dirname(file),
      `${path.basename(file, path.extname(file))}-assets-`,
    ),
  );
  await chmod(directory, 0o700);
  let copied = 0,
    bytes = 0,
    visited = 0;
  const relative = (target: string) =>
    "./" + path.relative(path.dirname(file), target).split(path.sep).join("/");
  const copy = async (source: string, destination: string) => {
    const size = (await stat(source)).size;
    if (size > 20 * 1024 * 1024)
      throw new Error("A saved dependency exceeds the 20 MiB limit.");
    if (++copied > 1000 || (bytes += size) > 50 * 1024 * 1024)
      throw new Error("Saved dependencies exceed 1000 files or 50 MiB.");
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    await chmod(destination, 0o600);
  };
  const copyProtos = async (
    source: string,
    destination: string,
  ): Promise<void> => {
    if (++visited > 2000)
      throw new Error(
        "Proto import roots are too broad; choose narrower import directories.",
      );
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const from = path.join(source, entry.name),
        to = path.join(destination, entry.name);
      if (entry.isDirectory() && ![".git", "node_modules"].includes(entry.name))
        await copyProtos(from, to);
      else if (entry.isFile() && entry.name.endsWith(".proto"))
        await copy(from, to);
    }
  };
  try {
    for (const [index, request] of requests.entries()) {
      if (request.dataset?.file) {
        if ((await stat(request.dataset.file)).size > 20 * 1024 * 1024)
          throw new Error("Dataset exceeds the 20 MiB limit.");
        datasetRows(
          await readFile(request.dataset.file, "utf8"),
          request.dataset,
        );
        const destination = path.join(
          directory,
          `${index}-dataset.${request.dataset.format}`,
        );
        await copy(request.dataset.file, destination);
        request.dataset.file = relative(destination);
      }
      if (request.upload) {
        const destination = path.join(directory, `${index}-upload`);
        await copy(request.upload.path, destination);
        request.upload.path = relative(destination);
      }
      if (request.protocol?.kind === "grpc") {
        const p = request.protocol;
        const originalProto = p.protoFile;
        const roots = [
          ...new Set(
            [...p.importPaths, path.dirname(p.protoFile)].map((root) =>
              path.resolve(root),
            ),
          ),
        ];
        const imports: string[] = [];
        for (const [rootIndex, root] of roots.entries()) {
          const destination = path.join(
            directory,
            `${index}-proto-${rootIndex}`,
          );
          await mkdir(destination, { recursive: true, mode: 0o700 });
          await copyProtos(root, destination);
          imports.push(relative(destination));
          if (root === path.resolve(path.dirname(originalProto)))
            p.protoFile = relative(
              path.join(destination, path.basename(originalProto)),
            );
        }
        p.importPaths = imports;
      }
    }
    return { source: generateScript(c), assets: directory };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
