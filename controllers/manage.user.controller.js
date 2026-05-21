import db from "../config/db.js";
import { formatDateOnly } from "../utils/formatDate.js";
import { buildLike } from "../utils/cleanText.js";

// GET ALL USERS
export const getUsers = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { role_id, is_active, search } = req.query;

    const currentRole = req.user.role_id;

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

    if (role_id !== undefined) {
      const roleNum = Number(role_id);

      if (allowedRoles && !allowedRoles.includes(roleNum)) {
        return res.json([]);
      }

      sql += ` AND u.role_id = ?`;
      params.push(roleNum);
    }

    if (is_active !== undefined) {
      sql += ` AND u.is_active = ?`;
      params.push(is_active);
    }

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
    console.error("❌ GET USERS ERROR:", err);
    console.error("STACK:", err.stack);

    res.status(500).json({ message: err.message });
  }
};

export const createUser = async (req, res) => {
  let connection;

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { username, password, first_name, last_name, role_id, customer_id, warehouse_id, license_no, license_expire, zones = [] } = req.body;

    const role = Number(role_id);

    if (!username || !password) {
      return res.status(400).json({
        message: "username/password required",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [exists] = await connection.query(`SELECT id FROM um_users WHERE username = ? LIMIT 1`, [username]);

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

      await connection.query(`INSERT INTO um_user_zones (user_id, zone_id) VALUES ?`, [values]);
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

export const updateUser = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;

    const { first_name, last_name, license_no, license_expire, is_active } = req.body;

    if (!id) {
      return res.status(400).json({ message: "id required" });
    }

    // เปลี่ยนสถานะ Active / Inactive
    if (is_active !== undefined) {
      await db.query(
        `
        UPDATE um_users
        SET is_active = ?
        WHERE id = ?
        `,
        [is_active, id],
      );

      return res.json({ message: "update status success" });
    }

    await db.query(
      `
      UPDATE um_users SET
        first_name = ?,
        last_name = ?,
        license_no = ?,
        license_expire = ?
      WHERE id = ?
      `,
      [first_name || null, last_name || null, license_no || null, license_expire || null, id],
    );

    res.json({ message: "update success" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteUserHard = async (req, res) => {
  let connection;

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;

    connection = await db.getConnection();
    await connection.beginTransaction();

    await connection.query(`DELETE FROM um_user_zones WHERE user_id = ?`, [id]);
    await connection.query(`DELETE FROM um_user_vehicles WHERE user_id = ?`, [id]);

    const [result] = await connection.query(`DELETE FROM um_users WHERE id = ?`, [id]);

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

