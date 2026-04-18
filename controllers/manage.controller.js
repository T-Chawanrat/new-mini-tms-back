import db from "../config/db.js";
import { normalizePlate, isValidPlate } from "../utils/plate.js";

/* =========================
   USERS (HR / IT / DEV)
========================= */

// GET ALL USERS
export const getUsers = async (req, res) => {
  try {
    const { role_id, is_active, search } = req.query;

    let sql = `
      SELECT 
        u.id,
        u.username,
        u.first_name,
        u.last_name,

        u.role_id,
        r.name AS role_name,

        u.customer_id,

        u.warehouse_id,
        w.name AS warehouse_name,

        u.is_active,
        u.license_no,
        u.license_expire,
        u.last_login,
        u.created_at

      FROM um_users u

      LEFT JOIN mm_roles r 
        ON u.role_id = r.id

      LEFT JOIN mm_warehouses w 
        ON u.warehouse_id = w.id

      WHERE 1=1
    `;

    const params = [];

    // =====================
    // 🔥 FILTER role
    // =====================
    if (role_id) {
      sql += ` AND u.role_id = ?`;
      params.push(role_id);
    }

    // =====================
    // 🔥 FILTER status
    // =====================
    if (is_active !== undefined) {
      sql += ` AND u.is_active = ?`;
      params.push(is_active);
    }

    // =====================
    // 🔥 SEARCH
    // =====================
    if (search) {
      sql += `
        AND (
          u.username LIKE ?
          OR u.first_name LIKE ?
          OR u.last_name LIKE ?
        )
      `;
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    // =====================
    // 🔥 ORDER
    // =====================
    sql += ` ORDER BY u.id DESC`;

    const [rows] = await db.query(sql, params);

    res.json(rows);
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

import { formatDateOnly } from "../utils/formatDate.js";

export const createUser = async (req, res) => {
  let connection;

  try {
    const {
      username,
      password,
      first_name,
      last_name,
      role_id,
      customer_id,
      warehouse_id,
      license_no,
      license_expire,
      zones = [],
    } = req.body;

    const role = Number(role_id);

    if (!username || !password) {
      return res.status(400).json({
        message: "username/password required",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 🔥 เพิ่ม validate username ซ้ำ (ไม่แตะ logic อื่น)
    const [exists] = await connection.query(
      `SELECT id FROM um_users WHERE username = ? LIMIT 1`,
      [username],
    );

    if (exists.length > 0) {
      await connection.rollback();
      connection.release();

      return res.status(400).json({
        message: "username นี้มีในระบบแล้ว",
      });
    }

    const formattedLicenseExpire = formatDateOnly(license_expire);

    if (role === 7 && (!license_no || !formattedLicenseExpire)) {
      await connection.rollback();
      connection.release();

      return res.status(400).json({
        message: "driver ต้องมี license_no และ license_expire",
      });
    }

    if (role === 3 && zones.length === 0) {
      await connection.rollback();
      connection.release();

      return res.status(400).json({
        message: "manager ต้องเลือก zone อย่างน้อย 1",
      });
    }

    let finalWarehouse = null;

    if ([3, 4, 9].includes(role)) {
      finalWarehouse = null;
    } else if (role === 6) {
      finalWarehouse = 15;
    } else {
      finalWarehouse = warehouse_id || null;
    }

    const [result] = await connection.query(
      `
      INSERT INTO um_users (
        username, password, first_name, last_name,
        role_id, customer_id, warehouse_id,
        license_no, license_expire, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
      [
        username,
        password,
        first_name || null,
        last_name || null,
        role,
        customer_id || null,
        finalWarehouse,
        role === 7 ? license_no : null,
        role === 7 ? formattedLicenseExpire : null,
      ],
    );

    const userId = result.insertId;

    if (role === 3 && zones.length > 0) {
      const values = zones.map((z) => [userId, z]);

      await connection.query(
        `INSERT INTO um_user_zones (user_id, zone_id) VALUES ?`,
        [values],
      );
    }

    await connection.commit();
    connection.release();

    res.json({
      message: "create success",
      id: userId,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    if (connection) connection.release();

    console.error("CREATE USER ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

// UPDATE USER
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;

    const { first_name, last_name, license_expire } = req.body;

    if (!id) {
      return res.status(400).json({ message: "id required" });
    }

    await db.query(
      `
      UPDATE um_users SET
        first_name = ?,
        last_name = ?,
        license_expire = ?
      WHERE id = ?
    `,
      [first_name || null, last_name || null, license_expire || null, id],
    );

    res.json({ message: "update success" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE USER (soft)
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      `
      UPDATE um_users SET is_active = 0 WHERE id = ?
    `,
      [id],
    );

    res.json({ message: "delete success" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* =========================
   VEHICLES
========================= */

// GET ALL VEHICLES
export const getVehicles = async (req, res) => {
  try {
    const { search, vehicle_type, usage_type, status } = req.query;

    let sql = `
      SELECT *
      FROM mm_vehicles
      WHERE 1=1
    `;

    const params = [];

    // 🔥 SEARCH
    if (search) {
      sql += `
        AND (
          license_plate LIKE ?
          OR brand LIKE ?
          OR model LIKE ?
        )
      `;
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    // 🔥 FILTER
    if (vehicle_type) {
      sql += ` AND vehicle_type = ?`;
      params.push(vehicle_type);
    }

    if (usage_type) {
      sql += ` AND usage_type = ?`;
      params.push(usage_type);
    }

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY id DESC`;

    const [rows] = await db.query(sql, params);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const createVehicle = async (req, res) => {
  try {
    let {
      license_plate,
      brand,
      model,
      vehicle_type,
      usage_type,
      capacity_kg,
      warehouse_id,
      status,
    } = req.body;

    if (!license_plate) {
      return res.status(400).json({ message: "license_plate required" });
    }

    // 🔥 normalize อย่างเดียวพอ
    const plate = license_plate
      .toString()
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/-/g, "");

    // ❗ ไม่ต้อง regex โหด เอาแค่ length กันพัง
    if (plate.length < 4) {
      return res.status(400).json({
        message: "ทะเบียนไม่ถูกต้อง",
      });
    }

    // capacity
    if (capacity_kg === undefined || capacity_kg === "") {
      return res.status(400).json({ message: "capacity required" });
    }
    if (isNaN(Number(capacity_kg))) {
      return res.status(400).json({ message: "capacity must be number" });
    }

    // status
    const allowedStatus = ["ACTIVE", "MAINTENANCE", "INACTIVE"];
    if (!allowedStatus.includes(status)) {
      return res.status(400).json({ message: "invalid status" });
    }

    const [result] = await db.query(
      `
      INSERT INTO mm_vehicles (
        license_plate, brand, model, vehicle_type,
        usage_type, capacity_kg, warehouse_id, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        plate,
        brand || null,
        model || null,
        vehicle_type || null,
        usage_type || null,
        Number(capacity_kg),
        warehouse_id || null,
        status,
      ],
    );

    res.json({ message: "create success", id: result.insertId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        message: "ทะเบียนนี้มีในระบบแล้ว",
      });
    }

    res.status(500).json({ message: err.message });
  }
};

export const updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    await db.query(
      `UPDATE mm_vehicles SET status = ? WHERE id = ?`,
      [status, id]
    );

    res.json({ message: "update success" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE VEHICLE (soft)
export const deleteVehicle = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(`DELETE FROM mm_vehicles WHERE id = ?`, [
      id,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "vehicle not found" });
    }

    res.json({ message: "delete success" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
