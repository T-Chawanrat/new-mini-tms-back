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