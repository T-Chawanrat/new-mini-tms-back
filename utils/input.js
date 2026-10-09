// ข้อความและรหัส

export const cleanText = (value) => {
  if (value === undefined || value === null) return null;

  const text = String(value).trim();

  return text === "" ? null : text;
};

export const cleanCode = (value) => {
  if (value === undefined || value === null || value === "") return null;

  const code = String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");

  return code || null;
};

export const cleanFileNamePart = (value) => {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");
};

// ตัวเลข
// ถ้าไม่ส่ง id, undefined, null, "" ให้ return null
export const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) return null;

  return numberValue;
};

// ถ้าไม่ส่ง cost, cod, weight, "" ให้ return 0
export const toNumberOrZero = (value) => {
  if (value === undefined || value === null || value === "") return 0;

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) return 0;

  return numberValue;
};

// จํานวน
export const toQty = (value) => {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) return 1;

  return Math.floor(numberValue);
};

// สถานะ
export const toYN = (value, defaultValue = "N") => {
  if (value === "Y" || value === true || value === 1 || value === "1") return "Y";
  if (value === "N" || value === false || value === 0 || value === "0") return "N";

  return defaultValue;
};

// เบอร์โทร
// ใช้ล้างเบอร์จาก Excel import และข้อมูลเปิดบิลที่คีย์มือก่อนบันทึก
export const cleanTel = (tel) => {
  if (!tel) return "";

  return tel
    .toString()
    .replace(/[^0-9]/g, "")
    .replace(/^66/, "0");
};

// ใช้ตรวจ format เบอร์โทร เช่น user, customer, shipper, recipient
export const isValidTel = (value, { required = false } = {}) => {
  const phone = String(value ?? "").trim();
  if (!phone) return !required;
  return /^0\d+$/.test(phone);
};

// ทะเบียนรถ
export const normalizePlate = (plate) => {
  if (!plate) return "";

  return plate.toString().trim().replace(/\s+/g, "").replace(/-/g, "");
};

export const isValidPlate = (plate) => {
  const normalized = normalizePlate(plate);
  return /^[ก-ฮ0-9]{2,8}$/.test(normalized);
};

// คำนำหน้าชื่อ
export const genderFromTitle = (value) => {
  const title = String(value ?? "").trim();
  if (title === "นาย") return "ชาย";
  if (title === "นาง" || title === "นางสาว") return "หญิง";
  return null;
};
