export const getUploadUrl = (folder, filename) => {
  if (!folder || !filename) return null;

  return `/uploads/${folder}/${filename}`;
};

export const getShipperROImageUrl = (filename) => {
  return getUploadUrl("ro", filename);
};