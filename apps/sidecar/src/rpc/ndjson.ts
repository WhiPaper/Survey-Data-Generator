import { Buffer } from "node:buffer";
import { StringDecoder } from "node:string_decoder";

export class NdjsonDecoder {
  private buffer = "";
  private readonly utf8Decoder = new StringDecoder("utf8");

  public push(chunk: string | Uint8Array): string[] {
    this.buffer += this.utf8Decoder.write(
      typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk),
    );
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.filter((line) => line.trim().length > 0);
  }

  public finish(): string[] {
    this.buffer += this.utf8Decoder.end();
    const line = this.buffer.trim();
    this.buffer = "";
    return line.length > 0 ? [line] : [];
  }
}

export const encodeNdjson = (message: unknown): string => `${JSON.stringify(message)}\n`;
