declare module "@dsnp/parquetjs" {
  export type ParquetFieldDefinition = {
    type: string;
    optional?: boolean;
    repeated?: boolean;
    encoding?: string;
    compression?: string;
  };

  export class ParquetSchema {
    constructor(fields: Record<string, ParquetFieldDefinition>);
  }

  export interface ParquetCursor {
    next(): Promise<Record<string, unknown> | null>;
  }

  export class ParquetReader {
    static openFile(path: string): Promise<ParquetReader>;
    getCursor(columns?: readonly (readonly string[])[]): ParquetCursor;
    close(): Promise<void>;
  }

  export class ParquetWriter {
    static openFile(schema: ParquetSchema, path: string): Promise<ParquetWriter>;
    appendRow(row: Record<string, unknown>): Promise<void>;
    close(): Promise<void>;
  }
}
