import { sha1 } from '@noble/hashes/sha1';
import { bytesToHex } from '@noble/hashes/utils';

// SHA-1 hashing for upload dedupe, mirroring Immich's own web client
// (web/src/lib/workers/hash-file.ts): incremental @noble/hashes over 5 MiB
// slices. @noble/hashes over crypto.subtle deliberately:
//   - crypto.subtle.digest has no streaming API — the whole file would have
//     to sit in memory, fatal for multi-GB videos. @noble hashes slice by
//     slice in constant memory.
//   - crypto.subtle is unavailable in insecure contexts (plain-HTTP LAN
//     installs of this proxy are common).
//   - It is exactly what Immich itself ships, so checksums match upstream.
export const HASH_SLICE_BYTES = 5 * 1024 * 1024;

// Blob.arrayBuffer() everywhere real; FileReader fallback for jsdom (tests)
// and ancient WebViews.
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('failed to read blob'));
    reader.readAsArrayBuffer(blob);
  });
}

// SHA-1 (hex) of a Blob/File, read in slices so memory stays constant.
// sliceBytes is overridable for tests only.
export async function sha1HexOfBlob(blob: Blob, sliceBytes = HASH_SLICE_BYTES): Promise<string> {
  const hasher = sha1.create();
  for (let offset = 0; offset < blob.size; offset += sliceBytes) {
    const slice = blob.slice(offset, Math.min(offset + sliceBytes, blob.size));
    hasher.update(new Uint8Array(await blobToArrayBuffer(slice)));
  }
  return bytesToHex(hasher.digest());
}
