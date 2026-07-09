import { sha1HexOfBlob } from './sha1';
import type { HashWorkerResponse } from './hash.worker';

interface PendingHash {
  resolve: (checksum: string) => void;
  reject: (error: Error) => void;
}

// FileHasher hashes files in a Web Worker (spawned lazily, terminated on
// dispose) and falls back to inline hashing where Workers are unavailable
// (jsdom in unit tests, exotic embedders). A crashed worker rejects its
// in-flight hashes and is torn down; later hashes run inline.
export class FileHasher {
  private worker: Worker | null = null;
  private workerBroken = false;
  private pending = new Map<number, PendingHash>();
  private nextId = 1;

  hash(file: Blob): Promise<string> {
    const worker = this.ensureWorker();
    if (!worker) {
      return sha1HexOfBlob(file);
    }

    return new Promise<string>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, file });
    });
  }

  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const { reject } of this.pending.values()) {
      reject(new Error('hasher disposed'));
    }
    this.pending.clear();
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.workerBroken || typeof Worker === 'undefined') return null;

    try {
      const worker = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<HashWorkerResponse>) => {
        const entry = this.pending.get(event.data.id);
        if (!entry) return;
        this.pending.delete(event.data.id);
        if ('checksum' in event.data) {
          entry.resolve(event.data.checksum);
        } else {
          entry.reject(new Error(event.data.error));
        }
      };
      worker.onerror = () => {
        // Worker died (e.g. failed to load): fail the in-flight hashes and
        // never respawn — callers treat a failed hash as "upload without
        // checksum", so this degrades gracefully instead of looping.
        this.workerBroken = true;
        this.worker = null;
        worker.terminate();
        for (const { reject } of this.pending.values()) {
          reject(new Error('hash worker crashed'));
        }
        this.pending.clear();
      };
      this.worker = worker;
      return worker;
    } catch {
      this.workerBroken = true;
      return null;
    }
  }
}
