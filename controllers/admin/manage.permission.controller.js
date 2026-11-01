import db from "../../config/db.js";

const menuPermissions = [
  ["DASHBOARD", "ประกาศและราคาน้ำมัน"], ["MANAGE_ANNOUNCEMENTS", "จัดการประกาศ"],
  ["MANAGE_RECIPIENTS", "จัดการผู้รับ"], ["MANAGE_ROUTES", "จัดการสายรถ"], ["CONTRACTOR_CREATE", "สร้างรถเสริม"],
  ["CREATE_RECEIVE", "สร้างบิล"], ["IMPORT_RECEIVE", "นำเข้าบิล"], ["RECEIVE_REPORT", "รายการบิล"],
  ["LABEL_PRINT", "พิมพ์สติกเกอร์"], ["DELIVERY_CLOSE", "ปิดงานจัดส่ง"], ["DELIVERY_ISSUES", "แชทแจ้งปัญหา"],
  ["WAREHOUSE_RECEIVE", "ยิงรับเข้าคลังต้นทาง"], ["PRODUCT_WAREHOUSE", "สินค้าในคลัง"], ["PRODUCT_TRUCK", "สินค้าบนรถ"],
  ["TRUCK_LOAD", "ใบปิดบรรทุก"], ["TRUCK_DELIVERY", "ใบรถกระจายสินค้า"], ["DC_RECEIVE", "ยิงรับเข้าคลังปลายทาง"],
  ["PENDING_REPORT_RECEIVE", "รายงานตามเลขที่บิล"], ["PENDING_REPORT_SN", "รายงานตาม S/N"], ["PENDING_REPORT_DT", "รายงานตามใบรถกระจาย"],
  ["MANAGE_USERS", "จัดการผู้ใช้งาน"], ["MANAGE_CUSTOMERS", "จัดการลูกค้า"], ["MANAGE_VEHICLES", "จัดการรถ"],
  ["MANAGE_SHIPPERS", "จัดการผู้ส่ง"], ["MANAGE_PACKAGES", "จัดการแพ็กเกจ"], ["MANAGE_HOLIDAYS", "จัดการวันหยุด"],
  ["MOVE", "ย้ายสินค้า"], ["DELIVERY_CLOSE_MEDIA", "แก้ไขรูปปิดงาน"], ["LOG_LABEL_PRINT", "ประวัติการพิมพ์ Label"],
  ["LOG_PRODUCT_TRUCK", "ประวัติบนรถขนย้าย"], ["LOG_DELIVERY_TRUCK", "ประวัติบนรถกระจาย"],
  ["LOG_PRODUCT_WAREHOUSE", "ประวัติสินค้าในคลัง"], ["LOG_RECEIVE_CREATE", "ประวัติการสร้างบิล"],
  ["LOG_RECEIVE_IMPORT", "ประวัติการนำเข้าข้อมูล"], ["MAP", "แผนที่"],
];

export const initializePermissions = async (_req, res) => {
  try {
    await db.query("INSERT INTO um_permissions (permission_code, permission_name) VALUES ? ON DUPLICATE KEY UPDATE permission_code = permission_code", [menuPermissions]);
    res.json({ message: "เตรียมรายการสิทธิ์แล้ว" });
  } catch (error) {
    console.error("initializePermissions error:", error);
    res.status(500).json({ message: "ไม่สามารถเตรียมรายการสิทธิ์ได้" });
  }
};

export const getPermissions = async (_req, res) => {
  try {
    const [rows] = await db.query("SELECT id, permission_code, permission_name FROM um_permissions ORDER BY id");
    res.json(rows);
  } catch (error) {
    console.error("getPermissions error:", error);
    res.status(500).json({ message: "ไม่สามารถโหลดรายการสิทธิ์ได้" });
  }
};

export const getMyPermissions = async (req, res) => {
  try {
    const [users] = await db.query("SELECT role_id FROM um_users WHERE id = ? AND is_active = 1", [req.user.id]);
    if (!users.length) return res.status(401).json({ message: "ไม่พบผู้ใช้งาน" });
    const roleId = Number(users[0].role_id);
    if (roleId === 1) return res.json({ is_super_admin: true, permissions: [] });
    const [rows] = await db.query(`
      SELECT permission.permission_code
      FROM um_permissions permission
      LEFT JOIN um_role_permissions role_permission ON role_permission.permission_id = permission.id AND role_permission.role_id = ?
      LEFT JOIN um_user_permissions user_permission ON user_permission.permission_id = permission.id AND user_permission.user_id = ?
      WHERE COALESCE(user_permission.is_allowed, role_permission.permission_id IS NOT NULL) = 1
    `, [roleId, req.user.id]);
    res.json({ is_super_admin: false, permissions: rows.map((row) => row.permission_code) });
  } catch (error) {
    console.error("getMyPermissions error:", error);
    res.status(500).json({ message: "ไม่สามารถโหลดสิทธิ์ได้" });
  }
};

export const getRolePermissions = async (req, res) => {
  try {
    const [roles] = await db.query("SELECT id, name FROM mm_roles WHERE id = ?", [req.params.roleId]);
    if (!roles.length) return res.status(404).json({ message: "ไม่พบ role" });
    const [permissions] = await db.query("SELECT permission_id FROM um_role_permissions WHERE role_id = ?", [req.params.roleId]);
    res.json({ role: roles[0], permission_ids: permissions.map((row) => row.permission_id) });
  } catch (error) {
    console.error("getRolePermissions error:", error);
    res.status(500).json({ message: "ไม่สามารถโหลดสิทธิ์ของ role ได้" });
  }
};

export const getUserPermissions = async (req, res) => {
  try {
    const [users] = await db.query("SELECT id, username, first_name, last_name, role_id FROM um_users WHERE id = ?", [req.params.userId]);
    if (!users.length) return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });
    const [rolePermissions] = await db.query("SELECT permission_id FROM um_role_permissions WHERE role_id = ?", [users[0].role_id]);
    const [overrides] = await db.query("SELECT permission_id, is_allowed FROM um_user_permissions WHERE user_id = ?", [users[0].id]);
    res.json({ user: users[0], role_permission_ids: rolePermissions.map((row) => row.permission_id), overrides });
  } catch (error) {
    console.error("getUserPermissions error:", error);
    res.status(500).json({ message: "ไม่สามารถโหลดสิทธิ์ผู้ใช้งานได้" });
  }
};

export const saveUserPermissions = async (req, res) => {
  const userId = Number(req.params.userId);
  const overrides = req.body.overrides;
  if (!Number.isInteger(userId) || userId < 1 || !Array.isArray(overrides) || overrides.some((item) => !Number.isInteger(item?.permission_id) || item.permission_id < 1 || typeof item.is_allowed !== "boolean") || new Set(overrides.map((item) => item.permission_id)).size !== overrides.length) {
    return res.status(400).json({ message: "ข้อมูลสิทธิ์ไม่ถูกต้อง" });
  }
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [users] = await connection.query("SELECT id FROM um_users WHERE id = ? FOR UPDATE", [userId]);
    if (!users.length) {
      await connection.rollback();
      return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });
    }
    if (overrides.length) {
      const [valid] = await connection.query("SELECT id FROM um_permissions WHERE id IN (?)", [overrides.map((item) => item.permission_id)]);
      if (valid.length !== overrides.length) {
        await connection.rollback();
        return res.status(400).json({ message: "ไม่พบสิทธิ์ที่เลือก" });
      }
    }
    await connection.query("DELETE FROM um_user_permissions WHERE user_id = ?", [userId]);
    if (overrides.length) await connection.query("INSERT INTO um_user_permissions (user_id, permission_id, is_allowed) VALUES ?", [overrides.map((item) => [userId, item.permission_id, Number(item.is_allowed)])]);
    await connection.commit();
    res.json({ message: "บันทึกสิทธิ์แล้ว" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("saveUserPermissions error:", error);
    res.status(500).json({ message: "ไม่สามารถบันทึกสิทธิ์ได้" });
  } finally {
    connection?.release();
  }
};

export const saveRolePermissions = async (req, res) => {
  const roleId = Number(req.params.roleId);
  const ids = req.body.permission_ids;
  if (!Number.isInteger(roleId) || roleId < 1 || !Array.isArray(ids) || ids.some((id) => !Number.isInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    return res.status(400).json({ message: "ข้อมูลสิทธิ์ไม่ถูกต้อง" });
  }
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [roles] = await connection.query("SELECT id FROM mm_roles WHERE id = ? FOR UPDATE", [roleId]);
    if (!roles.length) {
      await connection.rollback();
      return res.status(404).json({ message: "ไม่พบ role" });
    }
    if (ids.length) {
      const [valid] = await connection.query("SELECT id FROM um_permissions WHERE id IN (?)", [ids]);
      if (valid.length !== ids.length) {
        await connection.rollback();
        return res.status(400).json({ message: "ไม่พบสิทธิ์ที่เลือก" });
      }
    }
    await connection.query("DELETE FROM um_role_permissions WHERE role_id = ?", [roleId]);
    if (ids.length) await connection.query("INSERT INTO um_role_permissions (role_id, permission_id) VALUES ?", [ids.map((id) => [roleId, id])]);
    await connection.commit();
    res.json({ message: "บันทึกสิทธิ์แล้ว" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("saveRolePermissions error:", error);
    res.status(500).json({ message: "ไม่สามารถบันทึกสิทธิ์ได้" });
  } finally {
    connection?.release();
  }
};
