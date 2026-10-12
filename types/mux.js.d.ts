// Minimal typings for the part of mux.js we use.
declare module 'mux.js/cjs/mp4/transmuxer' {
  export type TransmuxedSegment = { initSegment: Uint8Array; data: Uint8Array; type: string };
  export class Transmuxer {
    constructor(options?: { remux?: boolean; keepOriginalTimestamps?: boolean });
    on(event: 'data', listener: (segment: TransmuxedSegment) => void): void;
    on(event: 'done', listener: () => void): void;
    push(bytes: Uint8Array): void;
    flush(): void;
  }
}
