import { StringDecoder } from "node:string_decoder";
export class LogBuffer {
  private decoder = new StringDecoder("utf8");
  private pending = "";
  private discarding = false;
  constructor(private consume: (line: string) => void) {}
  write(chunk: Buffer): void {
    this.pending += this.decoder.write(chunk);
    this.drain();
  }
  end(): void {
    this.pending += this.decoder.end();
    this.drain();
    if (this.pending && !this.discarding) this.consume(this.pending);
    this.pending = "";
  }
  private drain(): void {
    let newline: number;
    while ((newline = this.pending.indexOf("\n")) >= 0) {
      const line = this.pending.slice(0, newline);
      this.pending = this.pending.slice(newline + 1);
      if (!this.discarding)
        this.consume(
          line.length <= 65536 ? line : "[Oversized log record omitted]",
        );
      this.discarding = false;
    }
    if (this.pending.length > 65536) {
      this.pending = "";
      this.discarding = true;
      this.consume("[Oversized log record omitted]");
    }
  }
}
