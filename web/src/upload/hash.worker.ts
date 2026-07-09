// Web Worker that hashes files off the main thread so a 200-photo selection
// never janks the UI. One worker instance serves all files sequentially-ish
// (requests may interleave at await points; each has its own hasher state).
import { sha1HexOfBlob } from './sha1';

export interface HashWorkerRequest {
  id: number;
  file: Blob;
}

export type HashWorkerResponse =
  | { id: number; checksum: string }
  | { id: number; error: string };

self.onmessage = async (event: MessageEvent<HashWorkerRequest>) => {
  const { id, file } = event.data;
  try {
    const checksum = await sha1HexOfBlob(file);
    (self as unknown as Worker).postMessage({ id, checksum } satisfies HashWorkerResponse);
  } catch (error) {
    (self as unknown as Worker).postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies HashWorkerResponse);
  }
};
