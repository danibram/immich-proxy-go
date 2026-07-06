import { inflateRawSync } from 'node:zlib';

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(zip: Buffer): number {
  const minimumRecordSize = 22;
  const maximumCommentSize = 0xffff;
  const start = Math.max(0, zip.length - minimumRecordSize - maximumCommentSize);
  for (let offset = zip.length - minimumRecordSize; offset >= start; offset--) {
    if (zip.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }
  throw new Error(`invalid ZIP: end-of-central-directory record missing (${zip.length} bytes)`);
}

/** Extract the regular files written by Go's archive/zip package. */
export function unzipEntries(zip: Buffer): Map<string, Buffer> {
  const endOffset = findEndOfCentralDirectory(zip);
  const entryCount = zip.readUInt16LE(endOffset + 10);
  let directoryOffset = zip.readUInt32LE(endOffset + 16);
  const entries = new Map<string, Buffer>();

  for (let index = 0; index < entryCount; index++) {
    if (zip.readUInt32LE(directoryOffset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(`invalid ZIP: central directory entry ${index} missing`);
    }

    const compression = zip.readUInt16LE(directoryOffset + 10);
    const compressedSize = zip.readUInt32LE(directoryOffset + 20);
    const uncompressedSize = zip.readUInt32LE(directoryOffset + 24);
    const nameLength = zip.readUInt16LE(directoryOffset + 28);
    const extraLength = zip.readUInt16LE(directoryOffset + 30);
    const commentLength = zip.readUInt16LE(directoryOffset + 32);
    const localOffset = zip.readUInt32LE(directoryOffset + 42);
    const name = zip.subarray(directoryOffset + 46, directoryOffset + 46 + nameLength).toString();

    if (zip.readUInt32LE(localOffset) !== LOCAL_FILE_SIGNATURE) {
      throw new Error(`invalid ZIP: local header missing for ${name}`);
    }
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = zip.subarray(dataOffset, dataOffset + compressedSize);
    const contents = compression === 0 ? compressed : inflateRawSync(compressed);
    if (contents.length !== uncompressedSize) {
      throw new Error(`invalid ZIP: unexpected size for ${name}`);
    }
    entries.set(name, contents);

    directoryOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
