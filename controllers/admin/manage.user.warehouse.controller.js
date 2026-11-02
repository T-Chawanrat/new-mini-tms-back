import db from "../../config/db.js";

export const getUserWarehouses = async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) return res.status(400).json({ message: "ข้อมูลผู้ใช้งานไม่ถูกต้อง" });
  try {
    const [users] = await db.query("SELECT id FROM um_users WHERE id = ?", [userId]);
    if (!users.length) return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });
    const [rows] = await db.query("SELECT warehouse_id FROM um_user_warehouses WHERE user_id = ? AND is_active = 1", [userId]);
    return res.json({ warehouse_ids: rows.map((row) => row.warehouse_id) });
  } catch (error) {
    console.error("getUserWarehouses error:", error);
    return res.status(500).json({ message: "ไม่สามารถโหลดสิทธิ์คลังได้" });
  }
};

export const saveUserWarehouses = async (req, res) => {
  const userId = Number(req.params.userId);
  const ids = req.body?.warehouse_ids;
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Array.isArray(ids) || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return res.status(400).json({ message: "ข้อมูลผู้ใช้งานหรือคลังไม่ถูกต้อง" });
  }

  const warehouseIds = [...new Set(ids)];
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [users] = await connection.query("SELECT id FROM um_users WHERE id = ? FOR UPDATE", [userId]);
    if (!users.length) {
      await connection.rollback();
      return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });
    }
    if (warehouseIds.length) {
      const [valid] = await connection.query(
        "SELECT w.id FROM mm_warehouses w INNER JOIN mm_warehouses_to wt ON wt.warehouse_id = w.id WHERE w.id IN (?)",
        [warehouseIds],
      );
      if (new Set(valid.map((row) => Number(row.id))).size !== warehouseIds.length) {
        await connection.rollback();
        return res.status(400).json({ message: "มีคลังที่ไม่พบในข้อมูลคลังสำหรับเข้าสู่ระบบ" });
      }
    }
    const [existing] = await connection.query("SELECT id, warehouse_id, is_active FROM um_user_warehouses WHERE user_id = ? FOR UPDATE", [userId]);
    const selected = new Set(warehouseIds);
    const existingIds = new Set(existing.map((row) => Number(row.warehouse_id)));
    for (const row of existing) {
      const active = selected.has(Number(row.warehouse_id)) ? 1 : 0;
      if (Number(row.is_active) !== active) await connection.query("UPDATE um_user_warehouses SET is_active = ?, updated_at = NOW() WHERE id = ?", [active, row.id]);
    }
    for (const warehouseId of warehouseIds) {
      if (!existingIds.has(warehouseId)) {
        await connection.query("INSERT INTO um_user_warehouses (user_id, warehouse_id, is_active, created_by, created_at, updated_at) VALUES (?, ?, 1, ?, NOW(), NOW())", [userId, warehouseId, req.user.id]);
      }
    }
    await connection.commit();
    return res.json({ message: "บันทึกสิทธิ์คลังแล้ว" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("saveUserWarehouses error:", error);
    return res.status(500).json({ message: "ไม่สามารถบันทึกสิทธิ์คลังได้" });
  } finally {
    connection?.release();
  }
};
