declare module "better-sqlite3-multiple-ciphers" {
  interface Statement<Result = unknown> {
    run(...params: readonly unknown[]): { changes: number };
    get(...params: readonly unknown[]): Result | undefined;
    all(...params: readonly unknown[]): Result[];
  }
  export default class Database {
    public readonly open: boolean;
    public constructor(path: string);
    public key(key: Buffer): number;
    public pragma(source: string, options?: { simple?: boolean }): unknown;
    public exec(source: string): this;
    public prepare<Result = unknown>(source: string): Statement<Result>;
    public transaction<T>(fn: () => T): { immediate(): T };
    public close(): this;
  }
}
