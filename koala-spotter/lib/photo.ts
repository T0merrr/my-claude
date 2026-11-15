"use client";

import exifr from "exifr";

export interface PhotoExif {
  lat: number | null;
  lng: number | null;
  takenAt: Date | null;
  cameraModel: string | null;
}

export interface ProcessedPhoto {
  /** Re-encoded JPEG, max 1600 px. Re-encoding drops all EXIF. */
  photo: Blob;
  /** 480 px JPEG for map cards and the list. */
  thumb: Blob;
  exif: PhotoExif;
}

const MAX_PHOTO = 1600;
const MAX_THUMB = 480;

function looksLikeHeic(file: File): boolean {
  return (
    /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)
  );
}

function parseOffsetMinutes(offset: unknown): number | null {
  if (typeof offset !== "string") return null;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset.trim());
  if (!m) return null;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -mins : mins;
}

const EXIF_OPTIONS = {
  gps: true,
  exif: true,
  ifd0: {},
  pick: [
    "DateTimeOriginal",
    "CreateDate",
    "OffsetTimeOriginal",
    "OffsetTime",
    "Make",
    "Model",
    "GPSLatitude",
    "GPSLatitudeRef",
    "GPSLongitude",
    "GPSLongitudeRef",
  ],
};

type RawExif = Record<string, unknown> | undefined;

const hasUsefulExif = (d: RawExif) =>
  Boolean(d && (Number.isFinite(d.latitude) || d.DateTimeOriginal || d.CreateDate));

/**
 * Some HEIC encoders lay the file out in a way exifr's HEIC reader can't
 * follow. The EXIF block inside is still ordinary TIFF data, so find its
 * header and parse from there.
 */
async function parseExifFromHeicBytes(file: Blob): Promise<RawExif> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let tries = 0;
  for (let i = 0; i < bytes.length - 8 && tries < 6; i++) {
    const bigEndian = bytes[i] === 0x4d && bytes[i + 1] === 0x4d && bytes[i + 2] === 0 && bytes[i + 3] === 0x2a;
    const littleEndian = bytes[i] === 0x49 && bytes[i + 1] === 0x49 && bytes[i + 2] === 0x2a && bytes[i + 3] === 0;
    if (!bigEndian && !littleEndian) continue;
    tries++;
    try {
      const data = (await exifr.parse(bytes.subarray(i), EXIF_OPTIONS)) as RawExif;
      if (hasUsefulExif(data)) return data;
    } catch {
      // not a real EXIF block, keep looking
    }
  }
  return undefined;
}

export async function readExif(file: File | Blob): Promise<PhotoExif> {
  const empty: PhotoExif = { lat: null, lng: null, takenAt: null, cameraModel: null };
  try {
    let data: RawExif;
    try {
      data = (await exifr.parse(file, EXIF_OPTIONS)) as RawExif;
    } catch {
      data = undefined;
    }
    if (!hasUsefulExif(data) && file instanceof File && looksLikeHeic(file)) {
      data = (await parseExifFromHeicBytes(file)) ?? data;
    }
    if (!data) return empty;

    const lat = Number.isFinite(data.latitude) ? (data.latitude as number) : null;
    const lng = Number.isFinite(data.longitude) ? (data.longitude as number) : null;

    let takenAt: Date | null = null;
    const raw: unknown = data.DateTimeOriginal ?? data.CreateDate;
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
      // EXIF stores wall-clock time. exifr reads it as this phone's local
      // time, which is right unless the photo carries its own UTC offset.
      const offset = parseOffsetMinutes(data.OffsetTimeOriginal ?? data.OffsetTime);
      takenAt =
        offset === null
          ? raw
          : new Date(
              Date.UTC(
                raw.getFullYear(),
                raw.getMonth(),
                raw.getDate(),
                raw.getHours(),
                raw.getMinutes(),
                raw.getSeconds(),
              ) -
                offset * 60000,
            );
    }

    const make = typeof data.Make === "string" ? data.Make.trim() : "";
    const model = typeof data.Model === "string" ? data.Model.trim() : "";
    const cameraModel =
      [make && !model.toLowerCase().startsWith(make.toLowerCase()) ? make : "", model]
        .filter(Boolean)
        .join(" ") || null;

    return {
      // 0,0 is what some cameras write when they had no fix.
      lat: lat !== null && lng !== null && !(lat === 0 && lng === 0) ? lat : null,
      lng: lat !== null && lng !== null && !(lat === 0 && lng === 0) ? lng : null,
      takenAt,
      cameraModel,
    };
  } catch {
    return empty;
  }
}

type Drawable = ImageBitmap | HTMLImageElement;

async function decode(blob: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      // fall through to <img>
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("decode_failed"));
    };
    img.src = objectUrl;
  });
}

function sizeOf(d: Drawable): { w: number; h: number } {
  return d instanceof HTMLImageElement
    ? { w: d.naturalWidth, h: d.naturalHeight }
    : { w: d.width, h: d.height };
}

function toJpeg(d: Drawable, maxSide: number, quality: number): Promise<Blob> {
  const { w, h } = sizeOf(d);
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("canvas_unavailable"));
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(d, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("encode_failed"))),
      "image/jpeg",
      quality,
    ),
  );
}

export class PhotoError extends Error {
  constructor(public code: "not_an_image" | "heic_needs_connection" | "decode_failed") {
    super(code);
  }
}

/**
 * Reads EXIF from the original file, then re-encodes the pixels through a
 * canvas. The canvas output carries no metadata at all, so nothing from the
 * original EXIF (including GPS) reaches storage.
 */
export async function processPhoto(file: File): Promise<ProcessedPhoto> {
  if (file.type && !file.type.startsWith("image/") && !looksLikeHeic(file)) {
    throw new PhotoError("not_an_image");
  }

  const exif = await readExif(file);

  let drawable: Drawable;
  try {
    drawable = await decode(file);
  } catch {
    if (!looksLikeHeic(file)) throw new PhotoError("decode_failed");
    // Safari decodes HEIC itself. Other browsers need a converter, which is
    // large, so it is only downloaded when one of them meets a HEIC file.
    try {
      const { heicTo } = await import("heic-to");
      const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
      drawable = await decode(jpeg);
    } catch {
      throw new PhotoError(
        typeof navigator !== "undefined" && !navigator.onLine
          ? "heic_needs_connection"
          : "decode_failed",
      );
    }
  }

  const photo = await toJpeg(drawable, MAX_PHOTO, 0.82);
  const thumb = await toJpeg(drawable, MAX_THUMB, 0.72);
  if ("close" in drawable) drawable.close();

  return { photo, thumb, exif };
}
