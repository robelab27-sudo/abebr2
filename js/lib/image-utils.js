// ============================================================================
// Client-side image helpers for the Screenshot Manager:
// - compressImage(): resizes + re-encodes as JPEG before upload, so large
//   phone/monitor screenshots don't eat R2 storage or bandwidth.
// - rotateImageBlob(): rotates a blob 90° via canvas, used by the Rotate button.
// - fetchAuthenticatedImage(): screenshots are private, so <img src="..."> to
//   the API can't just work (no way to attach an Authorization header to an
//   <img> tag) — instead we fetch the bytes ourselves and hand back a local
//   blob: URL to assign as the src.
// ============================================================================

import { getMeta } from '../db.js';
import { API_BASE_URL } from '../config.js';

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.82;

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

/** Resize (if needed) and re-encode an image file/blob as a compressed JPEG. Returns { blob, width, height }. */
export async function compressImage(fileOrBlob) {
  const img = await loadImageFromBlob(fileOrBlob);
  let { width, height } = img;

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(img.src);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  return { blob, width, height };
}

/** Rotate an image blob 90° clockwise. Returns { blob, width, height }. */
export async function rotateImageBlob(blob) {
  const img = await loadImageFromBlob(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.height;
  canvas.height = img.width;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  URL.revokeObjectURL(img.src);

  const rotated = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  return { blob: rotated, width: canvas.width, height: canvas.height };
}

/** Fetch a private screenshot's bytes with auth and return a local blob: URL for use as an <img src>. */
export async function fetchAuthenticatedImage(screenshotId) {
  const token = await getMeta('auth_token');
  const response = await fetch(`${API_BASE_URL}/api/screenshots/${screenshotId}/file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`Failed to load image (${response.status})`);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
