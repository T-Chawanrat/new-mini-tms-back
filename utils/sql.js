import mysql from "mysql2";

const normalizeSearchText = (text) =>
  text
    ?.toString()
    .toLowerCase()
    .trim()
    .replace(/[\s\-_%]/g, "");

export const buildLike = (column, value) =>
  `LOWER(REPLACE(REPLACE(REPLACE(${column}, '-', ''), '_', ''), ' ', '')) 
   LIKE ${mysql.escape(`%${normalizeSearchText(value)}%`)}`;

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
