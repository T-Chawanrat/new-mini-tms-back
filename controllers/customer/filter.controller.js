import db from "../../config/db.js";
import { buildLike } from "../../utils/sql.js";

export const getReceiveCustomers = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { search } = req.query;

    let sql = `
      SELECT
        id,
        code,
        name
      FROM mm_customers
      WHERE is_active = '1'
    `;

    if (search) {
      sql += `
        AND (
          ${buildLike("code", search)}
          OR ${buildLike("name", search)}
        )
      `;
    }

    sql += `
      ORDER BY name ASC, id ASC
      LIMIT 300
    `;

    const [rows] = await db.query(sql);

    return res.json(rows);
  } catch (err) {
    console.error("GET RECEIVE CUSTOMERS ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
};

// GET WAREHOUSES
export const getWarehouses = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name
      FROM mm_warehouses
      ORDER BY name ASC
    `);

    res.json(rows);
  } catch (err) {
    console.error("warehouses error:", err);
    res.status(500).json({ message: err.message });
  }
};

export const searchAddress = async (req, res) => {
  try {
    const { keyword } = req.query;

    if (!keyword || String(keyword).trim().length < 2) {
      return res.json({ data: [], count: 0 });
    }

    const kw = `%${String(keyword).trim()}%`;

    const sql = `
      SELECT
        id,
        warehouse_id,
        subdistrict_id,
        subdistrict_name,
        district_id,
        district_name,
        province_id,
        province_name,
        zip_code
      FROM mm_master_addresses
      WHERE
        subdistrict_name LIKE ?
        OR district_name LIKE ?
        OR province_name LIKE ?
        OR zip_code LIKE ?
      ORDER BY province_name ASC, district_name ASC, subdistrict_name ASC
      LIMIT 50
    `;

    const params = [kw, kw, kw, kw];

    const [rows] = await db.query(sql, params);

    res.json({
      data: rows,
      count: rows.length,
    });
  } catch (err) {
    console.error("search address error:", err);
    res.status(500).json({ message: err.message });
  }
};

export const getRecipientTypes = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        id,
        name
      FROM mm_recipient_types
      WHERE is_deleted = 'N'
      ORDER BY id ASC
    `);

    res.json(rows);
  } catch (err) {
    console.error("GET RECIPIENT TYPES ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const getReceivePayments = async (req, res) => {
  try {
    const [rows] = await db.query(
      `
        SELECT
          id,
          name
        FROM mm_payments
        WHERE 1 = 1
        ORDER BY id ASC
      `,
    );

    return res.json(rows);
  } catch (err) {
    console.error("GET RECEIVE PAYMENTS ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const getProvinces = async (req, res) => {
  try {
    const [rows] = await db.query(
      `
        SELECT
          id,
          province_name
        FROM mm_province
        WHERE 1 = 1
        ORDER BY province_name ASC
      `,
    );

    return res.json(rows);
  } catch (err) {
    console.error("GET PROVINCES ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
};
