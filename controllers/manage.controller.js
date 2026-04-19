import db from "../config/db.js";
import { formatDateOnly } from "../utils/formatDate.js";
import { buildLike } from "../utils/cleanText.js";

// GET ALL USERS
export const getUsers = async (req, res) => {
  try {
    const { role_id, is_active, search } = req.query;

    // 🔥 ดึง role จาก header fallback (กัน undefined)
    const currentRole = req.user?.role_id || Number(req.headers.role_id);

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
      LEFT JOIN mm_roles r ON u.role_id = r.id
      LEFT JOIN mm_warehouses w ON u.warehouse_id = w.id
      WHERE 1=1
    `;

    const params = [];

    // =====================
    // 🔥 PERMISSION
    // =====================
    let allowedRoles = null;

    if (currentRole === 9) {
      allowedRoles = [3, 4, 5, 6, 7, 8, 9];
    } else if (currentRole === 10) {
      allowedRoles = [2, 3, 4, 5, 6, 7, 8, 9, 10];
    }

    if (allowedRoles) {
      sql += ` AND u.role_id IN (${allowedRoles.map(() => "?").join(",")})`;
      params.push(...allowedRoles);
    }

    // =====================
    // 🔥 FILTER role
    // =====================
    if (role_id !== undefined) {
      const roleNum = Number(role_id);

      if (allowedRoles && !allowedRoles.includes(roleNum)) {
        return res.json([]);
      }

      sql += ` AND u.role_id = ?`;
      params.push(roleNum);
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
          ${buildLike("u.username", search)}
          OR ${buildLike("u.first_name", search)}
          OR ${buildLike("u.last_name", search)}
        )
      `;
    }

    sql += ` ORDER BY u.id DESC`;

    const [rows] = await db.query(sql, params);

    res.json(rows);
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

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

    if ([3, 4, 9, 10].includes(role)) {
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

export const deleteUserHard = async (req, res) => {
  let connection;

  try {
    const { id } = req.params;

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 🔥 ลบ relation ก่อน (กัน FK error)
    await connection.query(`DELETE FROM um_user_zones WHERE user_id = ?`, [id]);

    await connection.query(`DELETE FROM um_user_vehicles WHERE user_id = ?`, [
      id,
    ]);

    // 🔥 ลบ user จริง
    const [result] = await connection.query(
      `DELETE FROM um_users WHERE id = ?`,
      [id],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      connection.release();

      return res.status(404).json({
        message: "user not found",
      });
    }

    await connection.commit();
    connection.release();

    res.json({ message: "hard delete success" });
  } catch (err) {
    if (connection) await connection.rollback();
    if (connection) connection.release();

    res.status(500).json({ message: err.message });
  }
};

export const getVehicles = async (req, res) => {
  try {
    const { search, vehicle_type, usage_type, status } = req.query;

    let sql = `
      SELECT *
      FROM mm_vehicles
      WHERE 1=1
    `;

    const params = [];

    // 🔥 SEARCH (ใช้ util)
    if (search) {
      sql += `
        AND (
          ${buildLike("license_plate", search)}
          OR ${buildLike("brand", search)}
          OR ${buildLike("model", search)}
        )
      `;
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

    await db.query(`UPDATE mm_vehicles SET status = ? WHERE id = ?`, [
      status,
      id,
    ]);

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

export const getCustomers = async (req, res) => {
  try {
    const { search } = req.query;

    let sql = `
      SELECT *
      FROM mm_customers
      WHERE 1=1
    `;

    if (search) {
      sql += `
        AND (
          ${buildLike("name", search)}
          OR ${buildLike("code", search)}
        )
      `;
    }

    sql += ` ORDER BY id DESC`;

    const [rows] = await db.query(sql);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ================= CUSTOMER ================= */

export const createCustomer = async (req, res) => {
  try {
    const { code, name, tax_id, address, contact_name, contact_tel } = req.body;

    const [result] = await db.query(
      `
      INSERT INTO mm_customers
      (code, name, import_type, tax_id, address, contact_name, contact_tel, is_active)
      VALUES (?, ?, 'STD', ?, ?, ?, ?, 1)
    `,
      [code, name, tax_id, address, contact_name, contact_tel],
    );

    res.json({ message: "create success", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { code, name, tax_id, address, contact_name, contact_tel } = req.body;

    await db.query(
      `
      UPDATE mm_customers SET
        code = ?,
        name = ?,
        import_type = 'STD',
        tax_id = ?,
        address = ?,
        contact_name = ?,
        contact_tel = ?
      WHERE id = ?
    `,
      [code, name, tax_id, address, contact_name, contact_tel, id],
    );

    res.json({ message: "update success" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteCustomer = async (req, res) => {
  let connection;

  try {
    const { id } = req.params;

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 🔥 ปิด customer
    const [result] = await connection.query(
      `UPDATE mm_customers SET is_active = 0 WHERE id = ?`,
      [id],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      connection.release();

      return res.status(404).json({
        message: "customer not found",
      });
    }

    // 🔥 ปิด user ของ customer นี้ทั้งหมด
    await connection.query(
      `UPDATE um_users SET is_active = 0 WHERE customer_id = ?`,
      [id],
    );

    await connection.commit();
    connection.release();

    res.json({ message: "delete success" });
  } catch (err) {
    if (connection) await connection.rollback();
    if (connection) connection.release();

    res.status(500).json({ message: err.message });
  }
};

export const deleteCustomerHard = async (req, res) => {
  let connection;

  try {
    const { id } = req.params;

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 🔥 ลบ user ของ customer ก่อน (กัน FK / orphan)
    await connection.query(`DELETE FROM um_users WHERE customer_id = ?`, [id]);

    // 🔥 ลบ customer จริง
    const [result] = await connection.query(
      `DELETE FROM mm_customers WHERE id = ?`,
      [id],
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      connection.release();

      return res.status(404).json({
        message: "customer not found",
      });
    }

    await connection.commit();
    connection.release();

    res.json({ message: "hard delete success" });
  } catch (err) {
    if (connection) await connection.rollback();
    if (connection) connection.release();

    res.status(500).json({ message: err.message });
  }
};

export const createCustomerUser = async (req, res) => {
  let connection;

  try {
    const { username, password, first_name, last_name, customer_id } = req.body;

    if (!username || !password || !customer_id) {
      return res.status(400).json({
        message: "username / password / customer required",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 🔥 check username ซ้ำ
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

    const CUSTOMER_ROLE = 2;

    // 🔥 insert (ไม่มี warehouse / license)
    const [result] = await connection.query(
      `
      INSERT INTO um_users (
        username, password, first_name, last_name,
        role_id, customer_id, warehouse_id,
        license_no, license_expire, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 1)
      `,
      [
        username,
        password,
        first_name || null,
        last_name || null,
        CUSTOMER_ROLE,
        customer_id,
      ],
    );

    await connection.commit();
    connection.release();

    res.json({
      message: "create customer user success",
      id: result.insertId,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    if (connection) connection.release();

    res.status(500).json({ message: err.message });
  }
};
