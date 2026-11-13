import db from "../../config/db.js";
import jwt from "jsonwebtoken";
import { verifyPassword } from "../../utils/password.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const CUSTOMER_ROLE_ID = 2;

export const login = async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ message: "กรุณากรอก username และ password" });
    }

    const [rows] = await db.query(
      `
        SELECT id, username, password, first_name, last_name, role_id, customer_id, license_no, license_expire, last_login
        FROM um_users
        WHERE username = ? AND is_active = 1
        LIMIT 1
      `,
      [username],
    );

    if (!rows.length) return res.status(404).json({ message: "ไม่พบบัญชีผู้ใช้นี้" });

    const user = rows[0];
    if (!(await verifyPassword(password, user.password))) {
      return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
    }

    if (Number(user.role_id) !== CUSTOMER_ROLE_ID) {
      return res.status(403).json({ message: "บัญชีนี้ไม่มีสิทธิ์เข้าใช้งานระบบ Customer" });
    }

    if (!Number.isInteger(Number(user.customer_id)) || Number(user.customer_id) <= 0) {
      return res.status(403).json({ message: "บัญชีลูกค้ายังไม่ได้ผูกกับ Customer" });
    }

    const now = new Date();
    await db.query("UPDATE um_users SET last_login = ? WHERE id = ?", [now, user.id]);

    const token = jwt.sign(
      { id: user.id, role_id: CUSTOMER_ROLE_ID, customer_id: Number(user.customer_id), purpose: "CUSTOMER_ACCESS" },
      JWT_SECRET,
      { expiresIn: "1d" },
    );

    return res.status(200).json({
      message: "เข้าสู่ระบบสำเร็จ",
      token,
      user: {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        role_id: CUSTOMER_ROLE_ID,
        customer_id: Number(user.customer_id),
        warehouse_id: null,
        warehouse_name: null,
        license_no: user.license_no,
        license_expire: user.license_expire,
        last_login: now,
        zones: [],
        vehicles: [],
      },
    });
  } catch (error) {
    console.error("customer login error:", error);
    return res.status(500).json({ message: "ไม่สามารถเข้าสู่ระบบได้" });
  }
};
