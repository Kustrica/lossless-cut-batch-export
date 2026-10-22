// Some MP4/MOV files have a damaged QuickTime metadata 'keys' box (moov/meta/keys or moov/udta/meta/keys).
// FFmpeg refuses to open such files ("The 'keys' atom with the invalid key count").
// Changing the type of the damaged box to 'free' makes the file readable again, without touching any media data.

export type ReadAt = (position: number, length: number) => Promise<Uint8Array>;

interface Box {
  type: string,
  start: number,
  contentStart: number,
  end: number,
}

const latin1 = new TextDecoder('latin1');

async function readBoxes(read: ReadAt, start: number, end: number) {
  const boxes: Box[] = [];
  let position = start;
  while (position + 8 <= end) {
    // eslint-disable-next-line no-await-in-loop
    const header = await read(position, Math.min(16, end - position));
    if (header.length < 8) break;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const type = latin1.decode(header.subarray(4, 8));
    let size = view.getUint32(0);
    let headerSize = 8;
    if (size === 1) {
      // 64-bit size
      if (header.length < 16) break;
      size = Number(view.getBigUint64(8));
      headerSize = 16;
    } else if (size === 0) {
      // box extends to the end of its parent
      size = end - position;
    }
    // invalid or truncated box, stop parsing this level
    if (size < headerSize || position + size > end) break;

    boxes.push({ type, start: position, contentStart: position + headerSize, end: position + size });
    position += size;
  }
  return boxes;
}

async function getMetaChildrenStart(read: ReadAt, meta: Box) {
  // ISO BMFF 'meta' is a full box (4 bytes version + flags before the children), but QuickTime style 'meta' is not.
  // QuickTime style 'meta' starts directly with a child box, normally 'hdlr'
  const peek = await read(meta.contentStart, 8);
  if (peek.length === 8 && latin1.decode(peek.subarray(4, 8)) === 'hdlr') return meta.contentStart;
  return meta.contentStart + 4;
}

// Same check as FFmpeg's mov_read_keys
async function isKeysBoxDamaged(read: ReadAt, keys: Box) {
  const contentSize = keys.end - keys.contentStart;
  if (contentSize < 8) return false; // FFmpeg ignores these
  const data = await read(keys.contentStart, 8);
  if (data.length < 8) return false;
  const count = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4); // after version + flags
  return count > Math.floor((contentSize - 8) / 8) || count >= Math.floor(0xFFFFFFFF / 8);
}

const getChildren = async (read: ReadAt, parents: Box[], type: string) => (await Promise.all(parents.map(async (parent) => (
  (await readBoxes(read, parent.contentStart, parent.end)).filter((box) => box.type === type)
)))).flat();

/**
 * @returns file positions of the type field of each damaged 'keys' box
 */
export async function findDamagedMetadataKeysBoxes(read: ReadAt, fileSize: number) {
  const moovBoxes = (await readBoxes(read, 0, fileSize)).filter((box) => box.type === 'moov');
  const metaBoxes = [
    ...await getChildren(read, moovBoxes, 'meta'),
    ...await getChildren(read, await getChildren(read, moovBoxes, 'udta'), 'meta'),
  ];

  const keysBoxes = (await Promise.all(metaBoxes.map(async (meta) => {
    const childrenStart = await getMetaChildrenStart(read, meta);
    return (await readBoxes(read, childrenStart, meta.end)).filter((box) => box.type === 'keys');
  }))).flat();

  const damaged = await Promise.all(keysBoxes.map(async (keys) => ((await isKeysBoxDamaged(read, keys)) ? keys.start + 4 : undefined)));
  return damaged.filter((position): position is number => position != null);
}

const freeBoxType = new Uint8Array([0x66, 0x72, 0x65, 0x65]); // 'free'

// The subset of Node's FileHandle that we need
export interface Mp4FileHandle {
  stat: () => Promise<{ size: number }>,
  read: (buffer: Uint8Array, offset: number, length: number, position: number) => Promise<{ bytesRead: number }>,
  write: (buffer: Uint8Array, offset: number, length: number, position: number) => Promise<unknown>,
}

/**
 * Repair the file in place, by changing the type of each damaged 'keys' box to 'free' (4 bytes per box).
 * Only box headers are read (no need to read through the media data), so this is fast even for large files.
 * @returns file positions that were changed
 */
export async function repairDamagedMetadataInFileHandle(fileHandle: Mp4FileHandle) {
  const { size } = await fileHandle.stat();
  const read: ReadAt = async (position, length) => {
    const buffer = new Uint8Array(length);
    const { bytesRead } = await fileHandle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
  };
  const positions = await findDamagedMetadataKeysBoxes(read, size);
  for (const position of positions) {
    // eslint-disable-next-line no-await-in-loop
    await fileHandle.write(freeBoxType, 0, freeBoxType.length, position);
  }
  return positions;
}
