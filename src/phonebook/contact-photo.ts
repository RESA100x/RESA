import {
  CONTACT_PHOTO_MAX_EDGE,
  CONTACT_PHOTO_MAX_LENGTH,
  isContactPhoto
} from './contact-model';

// The avatar is squared down to a small JPEG before it is stored, for two
// reasons: a phone photo straight off a camera is several megabytes and would
// bloat both the row and every `list_contacts` payload, and a common shape keeps
// the row avatars from jumping as you scroll.
const QUALITY_LADDER = [0.82, 0.6, 0.42];

export class ContactPhotoError extends Error {}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new ContactPhotoError('decode'));
      image.src = url;
    });
  } finally {
    // The bitmap is already in memory by the time this resolves.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function measure(bitmap: ImageBitmap | HTMLImageElement) {
  if (bitmap instanceof HTMLImageElement) {
    return { width: bitmap.naturalWidth, height: bitmap.naturalHeight };
  }
  return { width: bitmap.width, height: bitmap.height };
}

/**
 * Turn a picked file into the inline avatar the phone book stores. Throws a
 * `ContactPhotoError` for anything that is not an image and for an image that
 * cannot be drawn, so the caller can report one clear message.
 */
export async function prepareContactPhoto(file: Blob): Promise<string> {
  if (!file.type.startsWith('image/')) throw new ContactPhotoError('type');

  const bitmap = await decode(file);
  try {
    const { width, height } = measure(bitmap);
    if (!width || !height) throw new ContactPhotoError('decode');
    const scale = Math.min(1, CONTACT_PHOTO_MAX_EDGE / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new ContactPhotoError('unsupported');
    // A transparent PNG would otherwise become a black square once it is JPEG.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(bitmap as CanvasImageSource, 0, 0, targetWidth, targetHeight);

    // Walk the quality ladder until the encoded avatar fits the stored cap.
    for (const quality of QUALITY_LADDER) {
      const photo = canvas.toDataURL('image/jpeg', quality);
      if (photo.length <= CONTACT_PHOTO_MAX_LENGTH) return photo;
    }
    throw new ContactPhotoError('too-large');
  } finally {
    if (bitmap instanceof ImageBitmap) bitmap.close();
  }
}

/** The avatar to render, or null when there is nothing to show. */
export function contactPhotoSource(photo: string | null | undefined): string | null {
  return isContactPhoto(photo) ? photo : null;
}
