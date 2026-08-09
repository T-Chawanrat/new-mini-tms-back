import db from "../config/db.js";
import { buildLike } from "../utils/cleanText.js";

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
    console.error("roles error:", err);
    res.status(500).json({ message: err.message });
  }
};

export const getDriverUsers = async (req, res) => {
  try {
    const sql = `
      SELECT
        id,
        employee_code,
        title_name,
        first_name,
        last_name,
        gender,
        citizen_id,
        tel,
        role_id,
        warehouse_id,
        license_no,
        license_expire
      FROM um_users
      WHERE role_id = 7
      ORDER BY first_name ASC, last_name ASC
    `;

    const [rows] = await db.query(sql);

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("getDriverUsers error:", error);

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถโหลดรายชื่อพนักงานขับรถได้",
      error: error.message,
    });
  }
};

export const getActiveVehicles = async (req, res) => {
  try {
    const sql = `
      SELECT
        v.id,
        v.license_plate,
        v.license_plate_province_id,
        v.license_plate_province,

        v.model,
        v.color,
        v.vehicle_year,

        v.vehicle_type_id,
        vt.name AS vehicle_type_name,

        v.fuel_type,
        v.capacity_kg,
        v.max_load_kg,

        v.warehouse_id,
        w.warehouse_name,

        v.owner_type,
        v.owner_name,
        v.purchase_date,
        v.fleet_card_no,
        v.chassis_no,
        v.engine_no

      FROM mm_vehicles v

      LEFT JOIN mm_vehicle_types vt
        ON vt.id = v.vehicle_type_id

      LEFT JOIN mm_warehouses_to w
        ON w.warehouse_id = v.warehouse_id

      WHERE v.status = 'ACTIVE'
      ORDER BY v.license_plate ASC
    `;

    const [rows] = await db.query(sql);

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("getActiveVehicles error:", error);

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถโหลดรายการรถได้",
      error: error.message,
    });
  }
};

export const getCustomers = async (req, res) => {
  try {
    const { search } = req.query;

    let sql = `
      SELECT *
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
      ORDER BY id ASC
    `;

    const [rows] = await db.query(sql);

    res.json(rows);
  } catch (err) {
    console.error("customers error:", err);
    res.status(500).json({ message: err.message });
  }
};

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
      ORDER BY id ASC
    `);

    res.json(rows);
  } catch (err) {
    console.error("warehouses error:", err);
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
    console.error("zone error:", err);
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

export const getVehicleBrands = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name
      FROM mm_vehicle_brands
      ORDER BY name ASC
    `);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getVehicleTypes = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name
      FROM mm_vehicle_types
      ORDER BY id ASC
    `);

    res.json(rows);
  } catch (err) {
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

export const getReceiveDeliveryTypes = async (req, res) => {
  try {
    const [rows] = await db.query(
      `
        SELECT
          id,
          name
        FROM mm_delivery_types
        WHERE 1 = 1
        ORDER BY id ASC
      `,
    );

    return res.json(rows);
  } catch (err) {
    console.error("GET RECEIVE DELIVERY TYPES ERROR:", err);
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
        ORDER BY id ASC
      `,
    );

    return res.json(rows);
  } catch (err) {
    console.error("GET PROVINCES ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
};
