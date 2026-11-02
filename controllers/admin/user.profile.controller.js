import db from "../../config/db.js";
import { cleanText, isValidTel } from "../../utils/input.js";

export const getMyProfile = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.employee_code, u.username, u.title_name, u.first_name, u.last_name,
              u.gender, u.email, u.tel, u.role_id, r.name AS role_name, u.employment_type,
              u.warehouse_id, w.name AS warehouse_name, u.is_active, u.last_login,
              CASE WHEN u.role_id = 7 THEN u.license_no END AS license_no,
              CASE WHEN u.role_id = 7 THEN DATE_FORMAT(u.license_expire, '%Y-%m-%d') END AS license_expire
       FROM um_users u
       LEFT JOIN mm_roles r ON r.id = u.role_id
       LEFT JOIN mm_warehouses w ON w.id = u.warehouse_id
       WHERE u.id = ? AND u.is_active = 1 LIMIT 1`,
      [req.user.id],
    );
    if (!rows.length) return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });
    return res.json({ data: rows[0] });
  } catch (error) {
    console.error("getMyProfile error:", error);
    return res.status(500).json({ message: "ไม่สามารถโหลดข้อมูลผู้ใช้งานได้" });
  }
};

export const updateMyProfile = async (req, res) => {
  try {
    const [rows] = await db.query("SELECT role_id FROM um_users WHERE id = ? AND is_active = 1", [req.user.id]);
    if (!rows.length) return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });

    const { email, tel, license_no: licenseNo, license_expire: licenseExpire } = req.body || {};
    if ([email, tel, licenseNo, licenseExpire].some((value) => value != null && typeof value !== "string")) {
      return res.status(400).json({ message: "รูปแบบข้อมูลไม่ถูกต้อง" });
    }
    const hasLicense = licenseNo !== undefined || licenseExpire !== undefined;
    if (hasLicense && Number(rows[0].role_id) !== 7) return res.status(403).json({ message: "บัญชีนี้ไม่สามารถแก้ไขข้อมูลใบขับขี่ได้" });
    if (tel !== undefined && !isValidTel(tel)) return res.status(400).json({ message: "เบอร์โทรต้องขึ้นต้นด้วย 0" });
    if (licenseExpire && (!/^\d{4}-\d{2}-\d{2}$/.test(licenseExpire) || Number.isNaN(Date.parse(`${licenseExpire}T00:00:00Z`)) || new Date(`${licenseExpire}T00:00:00Z`).toISOString().slice(0, 10) !== licenseExpire)) {
      return res.status(400).json({ message: "วันหมดอายุใบขับขี่ไม่ถูกต้อง" });
    }

    const updates = [];
    const values = [];
    for (const [column, value] of [["email", email], ["tel", tel], ["license_no", licenseNo], ["license_expire", licenseExpire]]) {
      if (value !== undefined) { updates.push(`${column} = ?`); values.push(cleanText(value)); }
    }
    if (!updates.length) return res.status(400).json({ message: "ไม่มีข้อมูลที่ต้องการแก้ไข" });
    await db.query(`UPDATE um_users SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ? AND is_active = 1`, [...values, req.user.id]);
    return res.json({ message: "บันทึกข้อมูลสำเร็จ" });
  } catch (error) {
    console.error("updateMyProfile error:", error);
    return res.status(500).json({ message: "ไม่สามารถบันทึกข้อมูลผู้ใช้งานได้" });
  }
};
