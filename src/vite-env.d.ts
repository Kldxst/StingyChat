/// <reference types="vite/client" />

declare module 'prompt-compressor' {
  export type CompressionLevel = 'none' | 'very-low' | 'low' | 'medium';
  export function compress(
    text: string,
    options?: CompressionLevel | Record<string, unknown>,
  ): {
    output: string;
    stats: {
      tokensBefore: number;
      tokensAfter: number;
      saved: number;
      reductionPct: number;
    };
  };
}
