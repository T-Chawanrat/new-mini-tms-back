import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config({ silent: true });

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  connectionLimit: 10,

  connectTimeout: 60000,
  acquireTimeout: 60000,
});

export default db;
