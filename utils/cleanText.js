// server/utils/cleanText.js

import mysql from "mysql2";

export const cleanText = (text) =>
  text?.toString().toLowerCase().trim().replace(/[\s\-_%]/g, "");

export const buildLike = (column, value) =>
  `LOWER(REPLACE(REPLACE(REPLACE(${column}, '-', ''), '_', ''), ' ', '')) 
   LIKE ${mysql.escape(`%${cleanText(value)}%`)}`;

export const cleanValue = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return value;
};

export const cleanCode = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return String(value).trim();
};

export const cleanFileNamePart = (value) => {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");
};

export const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;

  const numberValue = Number(value);

  if (Number.isNaN(numberValue)) return null;

  return numberValue;
};