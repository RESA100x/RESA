import { describe, expect, it } from 'vitest';
import {
  CONTACT_PHOTO_MAX_LENGTH,
  isContactPhoto,
  normalizeContactPhoto
} from './contact-model';
import { ContactPhotoError, contactPhotoSource, prepareContactPhoto } from './contact-photo';

const validPhoto = 'data:image/jpeg;base64,QUJD';

describe('contact photos', () => {
  it('accepts the inline image shapes the picker produces', () => {
    expect(isContactPhoto(validPhoto)).toBe(true);
    expect(isContactPhoto('data:image/png;base64,AAAA')).toBe(true);
    expect(isContactPhoto('data:image/webp;base64,AAA=')).toBe(true);
  });

  it('rejects links, other mime types and oversized payloads', () => {
    // A URL would break the moment the picture moves; only inline data travels
    // with the contact.
    expect(isContactPhoto('https://example.com/a.png')).toBe(false);
    expect(isContactPhoto('data:image/svg+xml;base64,AAAA')).toBe(false);
    expect(isContactPhoto('data:image/jpeg;base64,<not base64>')).toBe(false);
    expect(isContactPhoto(`data:image/jpeg;base64,${'A'.repeat(CONTACT_PHOTO_MAX_LENGTH)}`)).toBe(false);
    expect(isContactPhoto('')).toBe(false);
    expect(isContactPhoto(undefined)).toBe(false);
  });

  it('normalizes anything unusable to "no picture"', () => {
    expect(normalizeContactPhoto(validPhoto)).toBe(validPhoto);
    expect(normalizeContactPhoto('nonsense')).toBe('');
    expect(normalizeContactPhoto(null)).toBe('');
  });

  it('only hands the view a source it can actually render', () => {
    expect(contactPhotoSource(validPhoto)).toBe(validPhoto);
    expect(contactPhotoSource('')).toBeNull();
    expect(contactPhotoSource(undefined)).toBeNull();
    expect(contactPhotoSource('data:image/gif;base64,AAAA')).toBeNull();
  });

  it('refuses a file that is not an image before touching a canvas', async () => {
    const pdf = new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' });
    await expect(prepareContactPhoto(pdf)).rejects.toBeInstanceOf(ContactPhotoError);
  });
});
