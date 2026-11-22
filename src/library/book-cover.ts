// The picker hands the backend a data URL; the backend writes the bytes to a
// file under `covers/` and keeps only the file name in the row. Squaring the
// image down to 420px keeps the file small enough for the spotlight and card
// without storing a full-resolution photo.
export const BOOK_COVER_MAX_EDGE = 420;
export const BOOK_COVER_MAX_LENGTH = 320 * 1024;

const QUALITY_LADDER = [0.82, 0.66, 0.5, 0.36];

export class BookCoverError extends Error {}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new BookCoverError('decode'));
      image.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function measure(bitmap: ImageBitmap | HTMLImageElement) {
  if (bitmap instanceof HTMLImageElement) {
    return { width: bitmap.naturalWidth, height: bitmap.naturalHeight };
  }
  return { width: bitmap.width, height: bitmap.height };
}

export async function prepareBookCover(file: Blob): Promise<string> {
  if (!file.type.startsWith('image/')) throw new BookCoverError('type');

  const bitmap = await decode(file);
  try {
    const { width, height } = measure(bitmap);
    if (!width || !height) throw new BookCoverError('decode');
    const scale = Math.min(1, BOOK_COVER_MAX_EDGE / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new BookCoverError('unsupported');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(bitmap as CanvasImageSource, 0, 0, targetWidth, targetHeight);

    for (const quality of QUALITY_LADDER) {
      const cover = canvas.toDataURL('image/jpeg', quality);
      if (cover.length <= BOOK_COVER_MAX_LENGTH) return cover;
    }
    throw new BookCoverError('too-large');
  } finally {
    if (bitmap instanceof ImageBitmap) bitmap.close();
  }
}
