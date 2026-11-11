/**
 * Photo compression on the device.
 *
 * The photo is decoded with its EXIF orientation applied, drawn to a canvas with the
 * longest side at most 1600 px, and exported as JPEG at quality 0.8. Re-encoding from
 * pixels drops every metadata block of the original file, including GPS location,
 * so no location ever leaves the device. tests/e2e/exif.spec.ts proves it in a real
 * browser.
 */

export const MAX_EDGE_PX = 1600;
export const JPEG_QUALITY = 0.8;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Target size for an image, keeping its aspect ratio. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE_PX) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Compresses an image file to a metadata-free JPEG. Browser only. */
export async function compressImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is not available');
      context.drawImage(bitmap, 0, 0, width, height);
      return await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available');
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo'))),
        'image/jpeg',
        JPEG_QUALITY,
      ),
    );
  } finally {
    bitmap.close();
  }
}

/** SHA-256 of a blob as lowercase hex. Call outside any Dexie transaction. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * True if JPEG bytes contain an EXIF (APP1 "Exif") segment. Scans the segment headers
 * before the image data; used by tests to prove compression strips metadata.
 */
export function jpegHasExif(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    const marker = bytes[offset + 1]!;
    if (marker === 0xda) return false; // start of scan: no more metadata segments
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (marker === 0xe1) {
      const id = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (id === 'Exif') return true;
    }
    offset += 2 + length;
  }
  return false;
}
