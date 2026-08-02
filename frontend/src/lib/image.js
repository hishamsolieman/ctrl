// Client-side image downscaling/compression.
//
// The DB stores images as base64 and MySQL's `max_allowed_packet` is only 1 MB,
// so a large photo's INSERT would exceed the packet and drop the connection.
// We therefore shrink every image to a target byte budget (default 512 KB)
// BEFORE upload — reducing quality first, then dimensions — always preserving
// the aspect ratio. Small, already-supported images pass through untouched.

const DEFAULT_MAX_BYTES = 512 * 1024;
const OK_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const err = new Error("Could not decode image");
      err.code = "unsupported";
      reject(err);
    };
    img.src = url;
  });
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function withExt(name, ext) {
  const base = (name || "image").replace(/\.[^./\\]+$/, "");
  return `${base}.${ext}`;
}

/**
 * Returns a File that is <= maxBytes when possible (best-effort otherwise),
 * keeping the original aspect ratio. Throws an Error with `.code = "unsupported"`
 * if the file can't be decoded as an image.
 */
export async function compressImage(file, maxBytes = DEFAULT_MAX_BYTES) {
  // Already an acceptable type and small enough — nothing to do.
  if (OK_TYPES.includes(file.type) && file.size <= maxBytes) return file;

  const img = await loadImage(file);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) {
    const err = new Error("Empty image");
    err.code = "unsupported";
    throw err;
  }

  const outType = "image/webp"; // great compression + preserves transparency
  // Reduce quality first (keeps full resolution), then progressively downscale.
  const scales = [1, 0.85, 0.72, 0.6, 0.5, 0.4, 0.32, 0.25, 0.2];
  const qualities = [0.9, 0.8, 0.7, 0.6, 0.5, 0.42, 0.35];

  let best = null;
  for (const s of scales) {
    const w = Math.max(1, Math.round(width * s));
    const h = Math.max(1, Math.round(height * s));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    for (const q of qualities) {
      const blob = await toBlob(canvas, outType, q);
      if (!blob) continue;
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= maxBytes) {
        return new File([blob], withExt(file.name, "webp"), { type: outType });
      }
    }
  }

  // Couldn't quite hit the target; return the smallest we produced.
  if (best) return new File([best], withExt(file.name, "webp"), { type: outType });
  const err = new Error("Could not process image");
  err.code = "unsupported";
  throw err;
}
