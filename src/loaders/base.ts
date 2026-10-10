export interface Loader {
  load(): Promise<string>;
}

export abstract class BaseLoader implements Loader {
  /** Text of each page, set by load() for paged formats such as PDF. */
  pages?: string[];

  constructor(protected readonly filePath: string) {}

  abstract load(): Promise<string>;
}
