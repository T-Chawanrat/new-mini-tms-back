export const normalizePlate = (plate) => {
  if (!plate) return "";

  return plate
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "");
};

export const isValidPlate = (plate) => {
  const pattern = /^[0-9]{1}[ก-ฮ]{2}[0-9]{1,4}$/;
  return pattern.test(plate);
};