import { readFile } from "node:fs/promises";
import { fingerprint } from "./definition";

interface Secrets {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}
export class ScriptReferences {
  constructor(
    private secrets: Secrets,
    private scope: string,
    private index: { get(): string[]; set(ids: string[]): PromiseLike<void> },
  ) {}
  private key(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new Error("Invalid script run identity.");
    return `script:${this.scope}:${id}`;
  }
  async save(id: string, file: string, digest: string): Promise<void> {
    await this.secrets.store(
      this.key(id),
      JSON.stringify({ schemaVersion: 1, file, digest }),
    );
    await this.index.set([...new Set([...this.index.get(), id])]);
  }
  async load(id: string): Promise<{ file: string; changed: boolean }> {
    const source = await this.secrets.get(this.key(id));
    if (!source)
      throw new Error(
        "The original script reference is unavailable. Select the script again.",
      );
    const record = JSON.parse(source);
    if (
      record.schemaVersion !== 1 ||
      typeof record.file !== "string" ||
      typeof record.digest !== "string"
    )
      throw new Error(
        "The original script reference is damaged. Select the script again.",
      );
    let content: string;
    try {
      content = await readFile(record.file, "utf8");
    } catch {
      throw new Error(
        "The original script is unavailable. Select its current location with Run Test File.",
      );
    }
    return {
      file: record.file,
      changed: fingerprint(content) !== record.digest,
    };
  }
  async retain(ids: string[]): Promise<void> {
    const existing = this.index.get();
    for (const id of existing)
      if (!ids.includes(id)) await this.secrets.delete(this.key(id));
    await this.index.set(existing.filter((id) => ids.includes(id)));
  }
}
