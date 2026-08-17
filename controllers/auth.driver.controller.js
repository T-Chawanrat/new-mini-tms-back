import db from "../config/db.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const ALLOWED_ROLE_IDS = [1, 7];

export const driverLogin = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        message: "กรุณากรอก username และ password",
      });
    }

    const [rows] = await db.query(
      `
        SELECT
          app_user.id,
          app_user.username,
          app_user.password,
          app_user.first_name,
          app_user.last_name,
          app_user.role_id,
          app_user.customer_id,
          app_user.license_no,
          app_user.license_expire,
          app_user.last_login,
          user_warehouse.warehouse_id,
          warehouse.warehouse_name
        FROM um_users app_user

        INNER JOIN um_user_warehouses user_warehouse
          ON user_warehouse.user_id = app_user.id
          AND user_warehouse.is_active = 1

        INNER JOIN mm_warehouses_to warehouse
          ON warehouse.warehouse_id = user_warehouse.warehouse_id

        WHERE app_user.username = ?
          AND app_user.is_active = 1
          AND app_user.role_id IN (?, ?)

        LIMIT 1
      `,
      [username, ...ALLOWED_ROLE_IDS],
    );

    if (!rows.length) {
      return res.status(404).json({
        message: "ไม่พบบัญชีผู้ใช้งาน หรือไม่มีสิทธิ์เข้าใช้งาน",
      });
    }

    const user = rows[0];

    if (password !== user.password) {
      return res.status(401).json({
        message: "รหัสผ่านไม่ถูกต้อง",
      });
    }

    const now = new Date();

    await db.query(
      `
        UPDATE um_users
        SET last_login = ?
        WHERE id = ?
      `,
      [now, user.id],
    );

    const token = jwt.sign(
      {
        id: user.id,
        role_id: user.role_id,
        customer_id: user.customer_id,
        warehouse_id: user.warehouse_id,
        purpose: "ACCESS",
      },
      JWT_SECRET,
      {
        expiresIn: "1d",
      },
    );

    return res.status(200).json({
      message: "เข้าสู่ระบบสำเร็จ",
      token,
      user: {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        role_id: user.role_id,
        warehouse_id: user.warehouse_id,
        warehouse_name: user.warehouse_name,
        customer_id: user.customer_id,
        license_no: user.license_no,
        license_expire: user.license_expire,
        last_login: now,
      },
    });
  } catch (error) {
    console.error("driverLogin error:", error);

    return res.status(500).json({
      message: "ไม่สามารถเข้าสู่ระบบได้",
    });
  }
};