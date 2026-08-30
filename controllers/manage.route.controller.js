import db from "../config/db.js";
import { cleanDbText, cleanRouteCode, toNumberOrNull } from "../utils/cleanText.js";

const routeDays = new Set(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);

export const getRoutes = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push("(r.route_code LIKE ? OR r.route_name LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [routes] = await db.query(
      `
      SELECT
        r.route_id,
        r.warehouse_id,
        warehouse.warehouse_name AS warehouse_name,
        r.route_code,
        r.route_name,
        r.cost_oil,
        r.is_deleted,
        rd.route_detail_id,
        rd.subdistrict_id,
        rdd.id AS route_detail_day_id,
        rdd.day,
        address.subdistrict_name AS subdistrict_name,
        address.district_name AS district_name,
        address.province_name AS province_name,
        address.zip_code AS zip_code
      FROM mm_routes r
      LEFT JOIN mm_warehouses_to warehouse ON warehouse.warehouse_id = r.warehouse_id
      LEFT JOIN mm_route_details rd ON rd.route_id = r.route_id
      LEFT JOIN mm_route_detail_days rdd ON rdd.route_detail_id = rd.route_detail_id
      LEFT JOIN mm_master_addresses address ON address.subdistrict_id = rd.subdistrict_id
      ${where}
      ORDER BY r.route_id DESC, rd.route_detail_id ASC, rdd.id ASC
    `,
      params,
    );

    res.json(routes);
  } catch (error) {
    console.error("getRoutes error:", error);
    res.status(500).json({ message: "ไม่สามารถโหลดข้อมูลสายรถได้" });
  }
};

export const createRoute = async (req, res) => {
  try {
    const warehouseId = toNumberOrNull(req.body.warehouse_id);
    const routeCode = cleanRouteCode(req.body.route_code);
    const routeName = cleanDbText(req.body.route_name);

    if (!warehouseId || !routeCode || !routeName) {
      return res.status(400).json({ message: "กรุณาเลือกคลัง และกรอกรหัสกับชื่อสายรถ" });
    }

    const [duplicateRows] = await db.query(`SELECT route_id FROM mm_routes WHERE warehouse_id = ? AND route_code = ? AND is_deleted = 'N' LIMIT 1`, [
      warehouseId,
      routeCode,
    ]);

    if (duplicateRows.length) {
      return res.status(409).json({ message: "รหัสสายรถนี้มีอยู่ในคลังที่เลือกแล้ว" });
    }

    const [result] = await db.query(`INSERT INTO mm_routes (warehouse_id, route_code, is_deleted, route_name) VALUES (?, ?, 'N', ?)`, [
      warehouseId,
      routeCode,
      routeName,
    ]);

    res.status(201).json({ route_id: result.insertId, message: "เพิ่มสายรถสำเร็จ" });
  } catch (error) {
    console.error("createRoute error:", error);
    res.status(500).json({ message: "ไม่สามารถเพิ่มสายรถได้" });
  }
};

export const updateRoute = async (req, res) => {
  try {
    const routeId = toNumberOrNull(req.params.routeId);
    const warehouseId = toNumberOrNull(req.body.warehouse_id);
    const routeCode = cleanRouteCode(req.body.route_code);
    const routeName = cleanDbText(req.body.route_name);

    if (!routeId || !warehouseId || !routeCode || !routeName) {
      return res.status(400).json({ message: "กรุณาเลือกคลัง และกรอกรหัสกับชื่อสายรถ" });
    }

    const [duplicateRows] = await db.query(
      `SELECT route_id FROM mm_routes WHERE warehouse_id = ? AND route_code = ? AND route_id <> ? AND is_deleted = 'N' LIMIT 1`,
      [warehouseId, routeCode, routeId],
    );

    if (duplicateRows.length) {
      return res.status(409).json({ message: "รหัสสายรถนี้มีอยู่ในคลังที่เลือกแล้ว" });
    }

    const [result] = await db.query(
      `UPDATE mm_routes SET warehouse_id = ?, route_code = ?, route_name = ? WHERE route_id = ?`,
      [warehouseId, routeCode, routeName, routeId],
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "ไม่พบสายรถที่เลือก" });
    }

    res.json({ message: "แก้ไขสายรถสำเร็จ" });
  } catch (error) {
    console.error("updateRoute error:", error);
    res.status(500).json({ message: "ไม่สามารถแก้ไขสายรถได้" });
  }
};

export const createRouteDetail = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const routeId = toNumberOrNull(req.params.routeId);
    const subdistrictId = toNumberOrNull(req.body.subdistrict_id);
    const days = [...new Set(Array.isArray(req.body.days) ? req.body.days : [])].filter((day) => routeDays.has(day));

    if (!routeId || !subdistrictId || !days.length) {
      return res.status(400).json({ message: "กรุณาเลือกตำบลและวันที่รถเข้า" });
    }

    await connection.beginTransaction();

    const [routeRows] = await connection.query(`SELECT route_id FROM mm_routes WHERE route_id = ? AND is_deleted = 'N' FOR UPDATE`, [routeId]);

    if (!routeRows.length) {
      await connection.rollback();
      return res.status(404).json({ message: "ไม่พบสายรถที่เลือก" });
    }

    const [duplicateRows] = await connection.query(
      `SELECT rd.route_detail_id
       FROM mm_route_details rd
       WHERE rd.subdistrict_id = ?
       LIMIT 1`,
      [subdistrictId],
    );

    if (duplicateRows.length) {
      await connection.rollback();
      return res.status(409).json({ message: "ตำบลนี้ถูกกำหนดอยู่ในสายรถอื่นแล้ว" });
    }

    const [detailResult] = await connection.query(`INSERT INTO mm_route_details (route_id, subdistrict_id) VALUES (?, ?)`, [routeId, subdistrictId]);

    const dayValues = days.map((day) => [detailResult.insertId, day]);
    await connection.query(`INSERT INTO mm_route_detail_days (route_detail_id, day) VALUES ?`, [dayValues]);

    await connection.commit();
    res.status(201).json({ route_detail_id: detailResult.insertId, message: "เพิ่มตำบลสำเร็จ" });
  } catch (error) {
    await connection.rollback();
    console.error("createRouteDetail error:", error);
    res.status(500).json({ message: "ไม่สามารถเพิ่มตำบลได้" });
  } finally {
    connection.release();
  }
};

export const updateRouteDetail = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const routeId = toNumberOrNull(req.params.routeId);
    const routeDetailId = toNumberOrNull(req.params.routeDetailId);
    const subdistrictId = toNumberOrNull(req.body.subdistrict_id);
    const days = [...new Set(Array.isArray(req.body.days) ? req.body.days : [])].filter((day) => routeDays.has(day));

    if (!routeId || !routeDetailId || !subdistrictId || !days.length) {
      return res.status(400).json({ message: "กรุณาเลือกตำบลและวันที่รถเข้า" });
    }

    await connection.beginTransaction();

    const [detailRows] = await connection.query(
      `SELECT route_detail_id FROM mm_route_details WHERE route_detail_id = ? AND route_id = ? FOR UPDATE`,
      [routeDetailId, routeId],
    );

    if (!detailRows.length) {
      await connection.rollback();
      return res.status(404).json({ message: "ไม่พบตำบลในสายรถที่เลือก" });
    }

    const [duplicateRows] = await connection.query(
      `SELECT route_detail_id FROM mm_route_details WHERE subdistrict_id = ? AND route_detail_id <> ? LIMIT 1`,
      [subdistrictId, routeDetailId],
    );

    if (duplicateRows.length) {
      await connection.rollback();
      return res.status(409).json({ message: "ตำบลนี้ถูกกำหนดอยู่ในสายรถอื่นแล้ว" });
    }

    await connection.query(`UPDATE mm_route_details SET subdistrict_id = ? WHERE route_detail_id = ?`, [subdistrictId, routeDetailId]);
    await connection.query(`DELETE FROM mm_route_detail_days WHERE route_detail_id = ?`, [routeDetailId]);
    await connection.query(`INSERT INTO mm_route_detail_days (route_detail_id, day) VALUES ?`, [days.map((day) => [routeDetailId, day])]);
    await connection.commit();

    res.json({ message: "แก้ไขตำบลสำเร็จ" });
  } catch (error) {
    await connection.rollback();
    console.error("updateRouteDetail error:", error);
    res.status(500).json({ message: "ไม่สามารถแก้ไขตำบลได้" });
  } finally {
    connection.release();
  }
};

export const updateRouteStatus = async (req, res) => {
  try {
    const routeId = toNumberOrNull(req.params.routeId);
    const isDeleted = req.body.is_deleted;

    if (!routeId || !["Y", "N"].includes(isDeleted)) {
      return res.status(400).json({ message: "ข้อมูลสถานะไม่ถูกต้อง" });
    }

    const [result] = await db.query(`UPDATE mm_routes SET is_deleted = ? WHERE route_id = ?`, [isDeleted, routeId]);

    if (!result.affectedRows) {
      return res.status(404).json({ message: "ไม่พบสายรถที่เลือก" });
    }

    res.json({ message: "เปลี่ยนสถานะสายรถสำเร็จ" });
  } catch (error) {
    console.error("updateRouteStatus error:", error);
    res.status(500).json({ message: "ไม่สามารถเปลี่ยนสถานะสายรถได้" });
  }
};

export const deleteRouteDetail = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const routeId = toNumberOrNull(req.params.routeId);
    const routeDetailId = toNumberOrNull(req.params.routeDetailId);

    if (!routeId || !routeDetailId) {
      return res.status(400).json({ message: "ข้อมูลตำบลไม่ถูกต้อง" });
    }

    await connection.beginTransaction();

    const [detailRows] = await connection.query(
      `SELECT route_detail_id FROM mm_route_details WHERE route_detail_id = ? AND route_id = ? FOR UPDATE`,
      [routeDetailId, routeId],
    );

    if (!detailRows.length) {
      await connection.rollback();
      return res.status(404).json({ message: "ไม่พบตำบลในสายรถที่เลือก" });
    }

    await connection.query(`DELETE FROM mm_route_detail_days WHERE route_detail_id = ?`, [routeDetailId]);
    await connection.query(`DELETE FROM mm_route_details WHERE route_detail_id = ?`, [routeDetailId]);
    await connection.commit();

    res.json({ message: "ลบตำบลสำเร็จ" });
  } catch (error) {
    await connection.rollback();
    console.error("deleteRouteDetail error:", error);
    res.status(500).json({ message: "ไม่สามารถลบตำบลได้" });
  } finally {
    connection.release();
  }
};
