export const MAX_IMAGE_BYTES = 1024 * 1024;
const UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function imageType(file: File) {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif" } as Record<string, string>)[extension ?? ""] ?? "";
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.naturalWidth && image.naturalHeight
      ? resolve(image)
      : reject(new Error("图片尺寸无效，请重新选择"));
    image.onerror = () => reject(new Error("无法读取这张图片，请使用 JPG、PNG 或 WebP 格式；拍照时可选择兼容格式"));
    image.src = url;
  });
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.type === "image/jpeg" && blob.size > 0) resolve(blob);
      else reject(new Error("当前浏览器无法压缩图片，请更换浏览器或选择较小的图片"));
    }, "image/jpeg", quality);
  });
}

/** Compress only when needed. Never mutate the original file or upload it here. */
export async function prepareTaskImage(file: File): Promise<File> {
  const type = imageType(file);
  if (!file.size || !type.startsWith("image/")) throw new Error("请选择有效的图片文件");
  if (UPLOAD_TYPES.has(type) && file.size <= MAX_IMAGE_BYTES) {
    return file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
  }
  // Avoid silently turning an animated image into a still frame.
  if (type === "image/gif") throw new Error("这张动图超过 1MB，请选择静态照片或较小的动图");

  const url = URL.createObjectURL(file);
  const canvas = document.createElement("canvas");
  try {
    // Modern mobile browsers apply camera EXIF orientation when decoding Image.
    const image = await loadImage(url);
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    let edge = Math.min(1920, longest);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持图片压缩，请更换浏览器重试");

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const scale = edge / longest;
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      // JPEG has no alpha channel; use white instead of a black background.
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.8, 0.72]) {
        const blob = await encodeJpeg(canvas, quality);
        if (blob.size <= MAX_IMAGE_BYTES) {
          const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
          return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
        }
      }
      // Redraw from the original, avoiding repeated lossy re-encoding.
      edge = Math.floor(edge * 0.85);
    }
    throw new Error("无法在保持清晰度的情况下压到 1MB，请裁剪到需要的内容或分开拍摄");
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}

export function formatImageSize(bytes: number) {
  return bytes >= MAX_IMAGE_BYTES ? `${(bytes / MAX_IMAGE_BYTES).toFixed(2)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
