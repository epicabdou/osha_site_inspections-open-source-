/**
 * Builds test JPEGs that carry EXIF GPS metadata, to prove the app strips it.
 * The base JPEG comes from a Playwright screenshot; an APP1 "Exif" segment with a GPS
 * IFD (latitude/longitude) is inserted right after the SOI marker.
 */

function u16(n: number) {
  return [(n >> 8) & 0xff, n & 0xff];
}
function u32(n: number) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** A big-endian TIFF block: IFD0 → GPS IFD with 51°30'N, 0°7'W. */
function exifTiff(): number[] {
  // Layout (offsets from the TIFF header start):
  //   0  header (8)            8  IFD0: 1 entry (2 + 12 + 4 = 18)
  //  26  GPS IFD: 4 entries (2 + 48 + 4 = 54)   80 latitude rationals (24)  104 longitude rationals (24)
  const entry = (tag: number, type: number, count: number, value: number[]) => [
    ...u16(tag),
    ...u16(type),
    ...u32(count),
    ...value,
  ];
  const ASCII = 2;
  const LONG = 4;
  const RATIONAL = 5;
  const rational = (num: number, den: number) => [...u32(num), ...u32(den)];
  return [
    ...[0x4d, 0x4d, 0x00, 0x2a], // "MM", 42
    ...u32(8),
    ...u16(1),
    ...entry(0x8825, LONG, 1, u32(26)), // GPSInfo IFD pointer
    ...u32(0),
    ...u16(4),
    ...entry(0x0001, ASCII, 2, [0x4e, 0, 0, 0]), // "N"
    ...entry(0x0002, RATIONAL, 3, u32(80)),
    ...entry(0x0003, ASCII, 2, [0x57, 0, 0, 0]), // "W"
    ...entry(0x0004, RATIONAL, 3, u32(104)),
    ...u32(0),
    ...rational(51, 1),
    ...rational(30, 1),
    ...rational(0, 1),
    ...rational(0, 1),
    ...rational(7, 1),
    ...rational(0, 1),
  ];
}

/** Returns a copy of `jpeg` with an EXIF APP1 segment containing GPS coordinates. */
export function withGpsExif(jpeg: Buffer): Buffer {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Not a JPEG');
  const payload = [...'Exif'.split('').map((c) => c.charCodeAt(0)), 0, 0, ...exifTiff()];
  const segment = Buffer.from([0xff, 0xe1, ...u16(payload.length + 2), ...payload]);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}
