import { describe, expect, it } from 'vitest';
import { fitWithin, jpegHasExif } from '@/lib/photos/compress';

describe('fitWithin', () => {
  it('scales the longest side down to 1600 px, keeping the aspect ratio', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });

  it('never scales up', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('jpegHasExif', () => {
  const soi = [0xff, 0xd8];
  const app0 = [
    0xff,
    0xe0,
    0x00,
    0x10,
    ...'JFIF'.split('').map((c) => c.charCodeAt(0)),
    0,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
  ];
  const app1 = [0xff, 0xe1, 0x00, 0x08, ...'Exif'.split('').map((c) => c.charCodeAt(0)), 0, 0];
  const sos = [0xff, 0xda, 0x00, 0x02];

  it('finds an EXIF segment', () => {
    expect(jpegHasExif(new Uint8Array([...soi, ...app0, ...app1, ...sos]))).toBe(true);
  });

  it('reports none when only JFIF is present', () => {
    expect(jpegHasExif(new Uint8Array([...soi, ...app0, ...sos]))).toBe(false);
  });

  it('ignores non-JPEG data', () => {
    expect(jpegHasExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});
