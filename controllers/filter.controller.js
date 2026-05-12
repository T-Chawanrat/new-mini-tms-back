import db from "../config/db.js";

// GET ROLES
export const getRoles = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name
      FROM mm_roles
      ORDER BY id ASC
    `);

    res.json(rows);
  } catch (err) {
    console.error("ROLES ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

// GET WAREHOUSES
export const getWarehouses = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name
      FROM mm_warehouses
      ORDER BY id ASC
    `);

    res.json(rows);
  } catch (err) {
    console.error("WAREHOUSE ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const getZones = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, zone_name
      FROM mm_zones
      ORDER BY id ASC
    `);

    res.json(rows);
  } catch (err) {
    console.error("ZONE ERROR:", err);
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
    console.error("SEARCH ADDRESS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};
