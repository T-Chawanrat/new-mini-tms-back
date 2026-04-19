import mysql from "mysql2";

export const cleanText = (text) =>
  text?.toString().toLowerCase().trim().replace(/[\s\-_%]/g, "");

export const buildLike = (column, value) =>
  `LOWER(REPLACE(REPLACE(REPLACE(${column}, '-', ''), '_', ''), ' ', '')) 
   LIKE ${mysql.escape(`%${cleanText(value)}%`)}`;