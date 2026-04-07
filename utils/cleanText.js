const mysql = require("mysql2");

exports.cleanText = (text) =>
  text?.toString().toLowerCase().trim().replace(/[\s\-_%]/g, "");

exports.buildLike = (column, value) =>
  `LOWER(REPLACE(REPLACE(REPLACE(${column}, '-', ''), '_', ''), ' ', '')) LIKE ${mysql.escape(
    `%${exports.cleanText(value)}%`
  )}`;
