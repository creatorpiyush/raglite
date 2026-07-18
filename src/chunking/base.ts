export interface Chunker {
  chunkSize: number;
  overlap: number;
  split(text: string): string[];
}

export abstract class BaseChunker implements Chunker {
  constructor(
    public chunkSize: number = 500,
    public overlap: number = 50,
  ) {}

  abstract split(text: string): string[];
}
