import { randomUUID } from "node:crypto";
import { validateQuickTest } from "./definition";
import type { QuickTest } from "./model";

export interface SavedTest {
  id: string;
  name: string;
  updatedAt: string;
}
interface Secrets {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}
interface Index {
  get(): SavedTest[];
  set(tests: SavedTest[]): PromiseLike<void>;
}
export class TestTemplates {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private secrets: Secrets,
    private index: Index,
    private scope: string,
  ) {}
  list(): SavedTest[] {
    return this.index.get();
  }
  private key(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new Error("Invalid saved-test identity.");
    return `test:${this.scope}:${id}`;
  }
  async load(id: string): Promise<QuickTest> {
    const source = await this.secrets.get(this.key(id));
    if (!source)
      throw new Error(
        "Saved test is unavailable or has been deleted. Re-enter its settings in New test.",
      );
    const data = JSON.parse(source);
    if (data.schemaVersion !== 1)
      throw new Error("Unsupported saved-test schema.");
    return validateQuickTest(data.config);
  }
  save(name: string, config: QuickTest): Promise<SavedTest> {
    const work = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (!name.trim() || name.length > 160)
          throw new Error("Saved-test name must contain 1–160 characters.");
        const test = {
          id: randomUUID(),
          name: name.trim(),
          updatedAt: new Date().toISOString(),
        };
        const value = JSON.stringify({
          schemaVersion: 1,
          config: validateQuickTest(config),
        });
        if (Buffer.byteLength(value) > 2 * 1024 * 1024)
          throw new Error("Saved test exceeds 2 MiB. Save a script instead.");
        await this.secrets.store(this.key(test.id), value);
        try {
          await this.index.set([test, ...this.index.get()]);
        } catch (error) {
          await this.secrets.delete(this.key(test.id));
          throw error;
        }
        return test;
      });
    this.queue = work;
    return work;
  }
  delete(id: string): Promise<void> {
    const work = this.queue
      .catch(() => undefined)
      .then(async () => {
        await this.secrets.delete(this.key(id));
        await this.index.set(this.index.get().filter((test) => test.id !== id));
      });
    this.queue = work;
    return work;
  }
}
