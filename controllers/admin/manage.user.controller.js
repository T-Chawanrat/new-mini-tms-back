import db from "../../config/db.js";
import { formatDateOnly } from "../../utils/format-date.js";
import { buildLike } from "../../utils/sql.js";
import { genderFromTitle, isValidTel } from "../../utils/input.js";
import { hashPassword } from "../../utils/password.js";

// GET ALL USERS
export const getUsers = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { role_id, is_active, search } = req.query;

    let sql = `
      SELECT 
        u.id,
        u.employee_code,
        u.username,
        u.title_name,
        u.first_name,
        u.last_name,
        u.gender,
        u.citizen_id,
        u.email,
        u.tel,
        u.role_id,
        r.name AS role_name,
        u.customer_id,
        u.warehouse_id,
        w.name AS warehouse_name,
        u.is_active,
        u.license_no,
        u.license_expire,
        u.last_login,
        u.created_at,
        u.updated_at
      FROM um_users u
      LEFT JOIN mm_roles r ON u.role_id = r.id
      LEFT JOIN mm_warehouses w ON u.warehouse_id = w.id
      WHERE 1=1
    `;

    const params = [];

    if (role_id !== undefined && role_id !== "") {
      const roleNum = Number(role_id);

      sql += ` AND u.role_id = ?`;
      params.push(roleNum);
    }

    if (is_active !== undefined && is_active !== "") {
      sql += ` AND u.is_active = ?`;
      params.push(is_active);
    }

    if (search) {
      sql += `
        AND (
          ${buildLike("u.employee_code", search)}
          OR ${buildLike("u.username", search)}
          OR ${buildLike("u.first_name", search)}
          OR ${buildLike("u.last_name", search)}
          OR ${buildLike("u.citizen_id", search)}
          OR ${buildLike("u.email", search)}
          OR ${buildLike("u.tel", search)}
          OR ${buildLike("u.license_no", search)}
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

// CREATE USER
export const createUser = async (req, res) => {
  let connection;

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const {
      employee_code,
      username,
      title_name,
      first_name,
      last_name,
      citizen_id,
      email,
      tel,
      role_id,
      customer_id,
      warehouse_id,
      license_no,
      license_expire,
      zones = [],
    } = req.body;

    const defaultPassword = "123456";
    const role = Number(role_id);
    const resolvedGender = genderFromTitle(title_name);

    if (!isValidTel(tel)) {
      return res.status(400).json({ message: "เบอร์โทรต้องขึ้นต้นด้วย 0" });
    }

    if (!username) {
      return res.status(400).json({
        message: "username required",
      });
    }

    if (!role) {
      return res.status(400).json({
        message: "role_id required",
      });
    }

    const hashedPassword = await hashPassword(defaultPassword);
    connection = await db.getConnection();
    await connection.beginTransaction();
    const now = new Date();

    const [existsUsername] = await connection.query(
      `
      SELECT id 
      FROM um_users 
      WHERE username = ? 
      LIMIT 1
      `,
      [username],
    );

    if (existsUsername.length > 0) {
      await connection.rollback();

      return res.status(400).json({
        message: "username นี้มีในระบบแล้ว",
      });
    }

    if (employee_code) {
      const [existsEmployeeCode] = await connection.query(
        `
        SELECT id 
        FROM um_users 
        WHERE employee_code = ? 
        LIMIT 1
        `,
        [employee_code],
      );

      if (existsEmployeeCode.length > 0) {
        await connection.rollback();

        return res.status(400).json({
          message: "รหัสพนักงานนี้มีในระบบแล้ว",
        });
      }
    }

    const formattedLicenseExpire = formatDateOnly(license_expire);

    if (role === 7 && (!license_no || !formattedLicenseExpire)) {
      await connection.rollback();

      return res.status(400).json({
        message: "driver ต้องมี license_no และ license_expire",
      });
    }

    if (role === 3 && zones.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        message: "manager ต้องเลือก zone อย่างน้อย 1",
      });
    }

    const finalWarehouse = role === 2 ? null : [1, 4, 6, 9, 10].includes(role) ? 15 : warehouse_id || null;

    const [result] = await connection.query(
      `
      INSERT INTO um_users (
        employee_code,
        username,
        password,
        title_name,
        first_name,
        last_name,
        gender,
        citizen_id,
        email,
        tel,
        role_id,
        customer_id,
        warehouse_id,
        license_no,
        license_expire,
        is_active,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `,
      [
        employee_code || null,
        username,
        hashedPassword,
        title_name || null,
        first_name || null,
        last_name || null,
        resolvedGender,
        citizen_id || null,
        email || null,
        tel || null,
        role,
        customer_id || null,
        finalWarehouse,
        role === 7 ? license_no : null,
        role === 7 ? formattedLicenseExpire : null,
        now,
        now,
      ],
    );

    const userId = result.insertId;

    if (finalWarehouse) {
      await connection.query(
        `INSERT INTO um_user_warehouses (user_id, warehouse_id, is_active) VALUES (?, ?, 1)`,
        [userId, finalWarehouse],
      );
    }

    if (role === 3 && zones.length > 0) {
      const values = zones.map((z) => [userId, z]);

      await connection.query(
        `
        INSERT INTO um_user_zones (user_id, zone_id) 
        VALUES ?
        `,
        [values],
      );
    }

    await connection.commit();

    res.json({
      message: "create success",
      id: userId,
      default_password: defaultPassword,
    });
  } catch (err) {
    if (connection) await connection.rollback();

    console.error("CREATE USER ERROR:", err);
    res.status(500).json({ message: err.message });
  } finally {
    connection?.release();
  }
};

// UPDATE USER PROFILE / STATUS
export const updateUser = async (req, res) => {
  try {
    const now = new Date();
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;

    const { employee_code, title_name, first_name, last_name, citizen_id, email, tel, license_no, license_expire, is_active } = req.body;
    const resolvedGender = genderFromTitle(title_name);

    if (!isValidTel(tel)) {
      return res.status(400).json({ message: "เบอร์โทรต้องขึ้นต้นด้วย 0" });
    }

    if (!id) {
      return res.status(400).json({ message: "id required" });
    }

    // เปลี่ยนสถานะ Active / Inactive
    if (is_active !== undefined) {
      await db.query(
        `
        UPDATE um_users
        SET 
          is_active = ?,
          updated_at = ?
        WHERE id = ?
        `,
        [is_active, now, id],
      );

      return res.json({ message: "update status success" });
    }

    if (employee_code) {
      const [existsEmployeeCode] = await db.query(
        `
        SELECT id 
        FROM um_users 
        WHERE employee_code = ? 
          AND id <> ?
        LIMIT 1
        `,
        [employee_code, id],
      );

      if (existsEmployeeCode.length > 0) {
        return res.status(400).json({
          message: "รหัสพนักงานนี้มีในระบบแล้ว",
        });
      }
    }

    if (citizen_id) {
      const [existsCitizenId] = await db.query(
        `
        SELECT id 
        FROM um_users 
        WHERE citizen_id = ? 
          AND id <> ?
        LIMIT 1
        `,
        [citizen_id, id],
      );

      if (existsCitizenId.length > 0) {
        return res.status(400).json({
          message: "เลขบัตรประชาชนนี้มีในระบบแล้ว",
        });
      }
    }

    const formattedLicenseExpire = formatDateOnly(license_expire);

    await db.query(
      `
      UPDATE um_users SET
        employee_code = ?,
        title_name = ?,
        first_name = ?,
        last_name = ?,
        gender = ?,
        citizen_id = ?,
        email = ?,
        tel = ?,
        license_no = ?,
        license_expire = ?,
        updated_at = ?
      WHERE id = ?
      `,
      [
        employee_code || null,
        title_name || null,
        first_name || null,
        last_name || null,
        resolvedGender,
        citizen_id || null,
        email || null,
        tel || null,
        license_no || null,
        formattedLicenseExpire || null,
        now,
        id,
      ],
    );

    res.json({ message: "update success" });
  } catch (err) {
    console.error("UPDATE USER ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};
