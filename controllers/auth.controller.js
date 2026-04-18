import db from "../config/db.js";
import { ROLES } from "../utils/roles.js";

export const login = async (req, res) => {
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
        id,
        username,
        password,
        first_name,
        last_name,
        role_id,
        warehouse_id,
        customer_id,
        license_no,
        license_expire,
        last_login
      FROM um_users
      WHERE username = ? AND is_active = 1
      LIMIT 1
      `,
      [username]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        message: "ไม่พบบัญชีผู้ใช้นี้",
      });
    }

    const user = rows[0];

    // ❌ ไม่ใช้ bcrypt แล้ว
    if (password !== user.password) {
      return res.status(401).json({
        message: "รหัสผ่านไม่ถูกต้อง",
      });
    }

    // update last login
    await db.query(
      "UPDATE um_users SET last_login = NOW() WHERE id = ?",
      [user.id]
    );

    // =====================
    // EXTRA DATA
    // =====================
    let zones = [];
    let vehicles = [];

    if (user.role_id === ROLES.MANAGER) {
      const [zoneRows] = await db.query(
        `
        SELECT z.id, z.zone_name
        FROM um_user_zones uz
        JOIN mm_zones z ON uz.zone_id = z.id
        WHERE uz.user_id = ?
        `,
        [user.id]
      );
      zones = zoneRows;
    }

    if (user.role_id === ROLES.DRIVER) {
      const [vehicleRows] = await db.query(
        `
        SELECT v.id, v.license_plate
        FROM um_user_vehicles uv
        JOIN mm_vehicles v ON uv.vehicle_id = v.id
        WHERE uv.user_id = ? AND uv.unassigned_at IS NULL
        `,
        [user.id]
      );
      vehicles = vehicleRows;
    }

    return res.json({
      message: "เข้าสู่ระบบสำเร็จ",
      user: {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        role_id: user.role_id,
        warehouse_id: user.warehouse_id,
        customer_id: user.customer_id,
        license_no: user.license_no,
        license_expire: user.license_expire,
        last_login: new Date(),
        zones,
        vehicles,
      },
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message,
    });
  }
};