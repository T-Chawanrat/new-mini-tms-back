export const getUploadUrl = (folder, filename) => {
  if (!folder || !filename) return null;

  return `/uploads/${folder}/${filename}`;
};

export const getShipperROImageUrl = (filename) => {
  return getUploadUrl("ro", filename);
};

const imageExtensions = [".jpg", ".jpeg", ".png", ".webp"];
const imageExtensionsByMimeType = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export const isSupportedImageMimeType = (mimeType) => {
  return Boolean(imageExtensionsByMimeType[mimeType]);
};

export const getImageFileExtension = (originalName, mimeType) => {
  const extension = String(originalName || "").match(/\.[^.]+$/)?.[0]?.toLowerCase();
  if (imageExtensions.includes(extension)) return extension;

  return imageExtensionsByMimeType[mimeType] || null;
};
