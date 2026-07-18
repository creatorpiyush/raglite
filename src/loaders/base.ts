export interface Loader {
  load(): Promise<string>;
}

export abstract class BaseLoader implements Loader {
  constructor(protected readonly filePath: string) {}

  abstract load(): Promise<string>;
}
