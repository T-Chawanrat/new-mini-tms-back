
import db from "../config/db.js";

export const login = async (req, res) => {
  let connection;
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "กรุณากรอก username และ password" });
    }

    connection = await db.getConnection();

    const [rows] = await connection.query(
      `
      SELECT 
        u.user_id,
        u.username,
        u.password,
        u.first_name,
        u.last_name,
        u.license_plate,
        u.role_id,
        r.role_name, 
        u.dc_id,
        dc.dc_name
      FROM um_users u
      LEFT JOIN mm_user_dc dc ON u.dc_id = dc.id
      LEFT JOIN um_roles r ON u.role_id = r.id 
        WHERE u.username = ?
      LIMIT 1
      `,
      [username]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบบัญชีผู้ใช้นี้" });
    }

    const user = rows[0];

    if (password !== user.password) {
      return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
    }

    return res.status(200).json({
      message: "เข้าสู่ระบบสำเร็จ",
      user: {
        user_id: user.user_id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        license_plate: user.license_plate,
        role_id: user.role_id,
        role_name: user.role_name,
        dc_id: user.dc_id,
        dc_name: user.dc_name,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "เกิดข้อผิดพลาด", error: err.message });
  } finally {
    if (connection) connection.release();
  }
};
