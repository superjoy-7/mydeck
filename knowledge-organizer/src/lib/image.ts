/**
 * Client-side image utilities.
 * Handles file reading, base64 encoding, and preview generation.
 */

export interface ImageUpload {
  file: File;
  base64: string;       // data URL with mime type prefix
  preview: string;     // object URL for <img> src
  name: string;
  size: number;         // bytes
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];

export function isAcceptedImageType(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Read a File and return base64 data URL + preview object URL.
 * Call revokePreview() to free memory when done.
 */
export function readImageFile(file: File): Promise<ImageUpload> {
  return new Promise((resolve, reject) => {
    if (!isAcceptedImageType(file)) {
      reject(new Error(`不支持的图片格式: ${file.type}，请上传 JPG/PNG/GIF/WebP/HEIC 格式`));
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      reject(new Error(`图片大小不能超过 10MB，当前: ${formatFileSize(file.size)}`));
      return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      const preview = URL.createObjectURL(file);
      resolve({
        file,
        base64,
        preview,
        name: file.name,
        size: file.size,
      });
    };

    reader.onerror = () => reject(new Error('读取图片文件失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * Revoke a preview object URL to free browser memory.
 */
export function revokePreview(preview: string) {
  URL.revokeObjectURL(preview);
}
