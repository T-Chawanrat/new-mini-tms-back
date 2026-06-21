// server/utils/cleanText.js

import mysql from "mysql2";

/**
 * ใช้สำหรับ search เท่านั้น
 * เช่น buildLike / ค้นหาชื่อ / ค้นหา code แบบไม่สน space, -, _, %
 * ห้ามใช้ cleanText ตอน insert ลง DB เพราะมัน lowerCase และลบ space
 */
export const cleanText = (text) =>
  text?.toString().toLowerCase().trim().replace(/[\s\-_%]/g, "");

export const buildLike = (column, value) =>
  `LOWER(REPLACE(REPLACE(REPLACE(${column}, '-', ''), '_', ''), ' ', '')) 
   LIKE ${mysql.escape(`%${cleanText(value)}%`)}`;

/**
 * ใช้กับค่าทั่วไป ถ้าไม่มีให้เป็น null
 */
export const cleanValue = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return value;
};

/**
 * ใช้กับ code ต่าง ๆ
 * เช่น customer_code, shipper_code, receive_code
 */
export const cleanCode = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return String(value).trim();
};

/**
 * ใช้กับชื่อไฟล์
 */
export const cleanFileNamePart = (value) => {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");
};

/**
 * ใช้ตอน insert/update ข้อความลง DB
 * ไม่ lowerCase, ไม่ลบ space, ไม่ลบขีด
 */
export const cleanDbText = (value) => {
  if (value === undefined || value === null) return null;

  const text = String(value).trim();

  return text === "" ? null : text;
};

/**
 * ใช้กับ id / foreign key
 */
export const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) return null;

  return numberValue;
};

/**
 * ใช้กับเงิน เช่น cod, cost, net
 */
export const toNumberOrZero = (value) => {
  if (value === undefined || value === null || value === "") return 0;

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) return 0;

  return numberValue;
};

/**
 * ใช้กับ qty
 */
export const toQty = (value) => {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) return 1;

  return Math.floor(numberValue);
};

/**
 * ใช้กับ enum Y/N
 */
export const toYN = (value, defaultValue = "N") => {
  if (value === "Y" || value === true || value === 1 || value === "1") return "Y";
  if (value === "N" || value === false || value === 0 || value === "0") return "N";

  return defaultValue;
};

/**
 * ใช้ทำ receive_code เช่น 20260614
 */
export const formatDateYYYYMMDD = (date = new Date()) => {
  const dateValue = date instanceof Date ? date : new Date(date);

  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, "0");
  const day = String(dateValue.getDate()).padStart(2, "0");

  return `${year}${month}${day}`;
};

/**
 * ใช้ pad running เช่น 1 => 000001
 */
export const padNumber = (value, length = 6) => {
  return String(value).padStart(length, "0");
};

/**
 * ใช้สร้าง INSERT dynamic
 */
export const buildInsertSql = (tableName, data) => {
  const columns = Object.keys(data);
  const placeholders = columns.map(() => "?").join(", ");
  const values = columns.map((column) => data[column]);

  return {
    sql: `
      INSERT INTO ${tableName}
      (${columns.join(", ")})
      VALUES (${placeholders})
    `,
    values,
  };
};