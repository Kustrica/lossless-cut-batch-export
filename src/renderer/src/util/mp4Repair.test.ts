import { describe, it, expect } from 'vitest';

import type { Mp4FileHandle } from './mp4Repair';
import { findDamagedMetadataKeysBoxes, repairDamagedMetadataInFileHandle } from './mp4Repair';

const encoder = new TextEncoder();

function u32(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((acc, p) => acc + p.length, 0));
  let pos = 0;
  parts.forEach((p) => { out.set(p, pos); pos += p.length; });
  return out;
}

function box(type: string, ...content: Uint8Array[]) {
  const body = concat(...content);
  return concat(u32(8 + body.length), encoder.encode(type), body);
}

function box64(type: string, ...content: Uint8Array[]) {
  const body = concat(...content);
  const size = new Uint8Array(8);
  new DataView(size.buffer).setBigUint64(0, BigInt(16 + body.length));
  return concat(u32(1), encoder.encode(type), size, body);
}

const versionFlags = new Uint8Array(4);
const hdlr = box('hdlr', versionFlags, u32(0), encoder.encode('mdta'), new Uint8Array(13));
const validKeys = box('keys', versionFlags, u32(1), box('mdta', encoder.encode('encoder')));
// Like the files seen in the wild: version/flags, count and the first entry's header are missing
const damagedKeys = box('keys', encoder.encode('dtaencoder'), new Uint8Array(3), encoder.encode('lilst'));
const ilst = box('ilst');
const ftyp = box('ftyp', encoder.encode('isom'), u32(512), encoder.encode('isomiso2avc1mp41'));
const mdat = box('mdat', new Uint8Array(100));

function readerFor(file: Uint8Array) {
  return async (position: number, length: number) => file.subarray(position, position + length);
}

function typeAt(file: Uint8Array, position: number) {
  return new TextDecoder().decode(file.subarray(position, position + 4));
}

async function find(file: Uint8Array) {
  return findDamagedMetadataKeysBoxes(readerFor(file), file.length);
}

describe('findDamagedMetadataKeysBoxes', () => {
  it('finds damaged keys box in moov/udta/meta (QuickTime style meta)', async () => {
    const file = concat(ftyp, mdat, box('moov', box('mvhd', new Uint8Array(100)), box('udta', box('meta', hdlr, damagedKeys, ilst), box('free', new Uint8Array(20)))));
    const positions = await find(file);
    expect(positions).toHaveLength(1);
    expect(typeAt(file, positions[0]!)).toBe('keys');
  });

  it('finds damaged keys box in moov/meta (ISO full box meta)', async () => {
    const file = concat(ftyp, box('moov', box('meta', versionFlags, hdlr, damagedKeys, ilst)), mdat);
    const positions = await find(file);
    expect(positions).toHaveLength(1);
    expect(typeAt(file, positions[0]!)).toBe('keys');
  });

  it('handles 64-bit box sizes', async () => {
    const file = concat(ftyp, box64('mdat', new Uint8Array(100)), box64('moov', box('udta', box('meta', hdlr, damagedKeys, ilst))));
    const positions = await find(file);
    expect(positions).toHaveLength(1);
    expect(typeAt(file, positions[0]!)).toBe('keys');
  });

  it('handles last box with size 0 (extends to end of file)', async () => {
    const moov = box('moov', box('udta', box('meta', hdlr, damagedKeys, ilst)));
    new DataView(moov.buffer, moov.byteOffset).setUint32(0, 0);
    const file = concat(ftyp, mdat, moov);
    expect(await find(file)).toHaveLength(1);
  });

  it('does not report valid keys boxes', async () => {
    const file = concat(ftyp, mdat, box('moov', box('meta', hdlr, validKeys, ilst), box('udta', box('meta', hdlr, validKeys, ilst))));
    expect(await find(file)).toEqual([]);
  });

  it('ignores keys boxes outside of moov meta', async () => {
    const file = concat(ftyp, damagedKeys, box('moov', box('trak', box('meta', hdlr, damagedKeys))), mdat);
    expect(await find(file)).toEqual([]);
  });

  it('does not throw on truncated or garbage files', async () => {
    const file = concat(ftyp, box('moov', box('udta', box('meta', hdlr, damagedKeys))));
    expect(await find(file.subarray(0, -10))).toEqual([]);
    expect(await find(new Uint8Array([0, 0, 0, 3, 1, 2, 3]))).toEqual([]);
    expect(await find(new Uint8Array(0))).toEqual([]);
  });
});

// In-memory file handle. `virtualSize` zero bytes between `head` and `tail` are not stored, to simulate huge media data
function memoryFileHandle(head: Uint8Array, { virtualSize = 0, tail = new Uint8Array(0) } = {}) {
  const tailStart = head.length + virtualSize;
  const size = tailStart + tail.length;
  const stats = { bytesRead: 0, writtenPositions: [] as number[] };

  const handle: Mp4FileHandle = {
    stat: async () => ({ size }),
    read: async (buffer, offset, length, position) => {
      const bytesRead = Math.max(0, Math.min(length, size - position));
      const byteAt = (pos: number) => {
        if (pos < head.length) return head[pos]!;
        if (pos >= tailStart) return tail[pos - tailStart]!;
        return 0;
      };
      buffer.set(Uint8Array.from({ length: bytesRead }, (_v, i) => byteAt(position + i)), offset);
      stats.bytesRead += bytesRead;
      return { bytesRead };
    },
    write: async (buffer, offset, length, position) => {
      const data = buffer.subarray(offset, offset + length);
      if (position + length <= head.length) head.set(data, position);
      else if (position >= tailStart) tail.set(data, position - tailStart);
      else throw new Error('Write to media data');
      stats.writtenPositions.push(position);
    },
  };
  return { handle, stats };
}

describe('repairDamagedMetadataInFileHandle', () => {
  it('changes only the type of the damaged box, in place', async () => {
    const original = concat(ftyp, mdat, box('moov', box('mvhd', new Uint8Array(100)), box('udta', box('meta', hdlr, damagedKeys, ilst))));
    const file = new Uint8Array(original);
    const { handle } = memoryFileHandle(file);

    const positions = await repairDamagedMetadataInFileHandle(handle);
    expect(positions).toHaveLength(1);
    expect(typeAt(file, positions[0]!)).toBe('free');
    const changed = [...file.keys()].filter((i) => file[i] !== original[i]);
    expect(changed.every((i) => i >= positions[0]! && i < positions[0]! + 4)).toBe(true);
    expect(await find(file)).toEqual([]); // repaired
  });

  it('reads only box headers of a large file', async () => {
    const mediaSize = 800_000_000;
    const mdatHeader = new Uint8Array(8);
    new DataView(mdatHeader.buffer).setBigUint64(0, BigInt(16 + mediaSize));
    const head = concat(ftyp, u32(1), encoder.encode('mdat'), mdatHeader);
    const tail = box('moov', box('mvhd', new Uint8Array(100)), box('udta', box('meta', hdlr, damagedKeys, ilst)));
    const { handle, stats } = memoryFileHandle(head, { virtualSize: mediaSize, tail });

    const positions = await repairDamagedMetadataInFileHandle(handle);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toBeGreaterThan(mediaSize);
    expect(stats.writtenPositions).toEqual(positions);
    expect(stats.bytesRead).toBeLessThan(1000);
    expect(typeAt(tail, positions[0]! - head.length - mediaSize)).toBe('free');
  });

  it('does not write anything when there is no damage', async () => {
    const original = concat(ftyp, mdat, box('moov', box('udta', box('meta', hdlr, validKeys, ilst))));
    const file = new Uint8Array(original);
    const { handle, stats } = memoryFileHandle(file);

    expect(await repairDamagedMetadataInFileHandle(handle)).toEqual([]);
    expect(stats.writtenPositions).toEqual([]);
    expect(file).toEqual(original);
  });
});
