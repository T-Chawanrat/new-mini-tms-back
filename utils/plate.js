export const normalizePlate = (plate) => {
  if (!plate) return "";

  return plate
    .toString()
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "");
};

export const isValidPlate = (plate) => {
  const normalized = normalizePlate(plate);

  // อนุญาตเฉพาะภาษาไทย + ตัวเลข
  // ความยาว 2-8 ตัวอักษร พอสำหรับทะเบียนทั่วไป
  const pattern = /^[ก-ฮ0-9]{2,8}$/;

  return pattern.test(normalized);
};