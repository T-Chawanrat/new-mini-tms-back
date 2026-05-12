import db from "../config/db.js";

// =======================
// GET: โหลดรายการ SN + สถานะยิงแล้ว
// =======================
export const getWarehouseVerifyList = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { warehouse_id, search } = req.query;

    let sql = `
      SELECT 
        s.id,
        s.serial_no,
        s.reference,
        s.recipient_name,
        s.shipper_code,             
        s.warehouse_id,
        w.name AS warehouse_name,  
        s.import_log_id

      FROM shipments s
      LEFT JOIN mm_warehouses w 
        ON w.id = s.warehouse_id
      WHERE 1=1
    `;

    const params = [];

    if (warehouse_id) {
      sql += ` AND s.warehouse_id = ?`;
      params.push(warehouse_id);
    }

    if (search) {
      sql += ` AND (
        s.serial_no LIKE ?
        OR s.reference LIKE ?
        OR s.recipient_name LIKE ?
      )`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY s.id DESC LIMIT 1000`;

    const [rows] = await connection.query(sql, params);

    res.json({
      total: rows.length,
      data: rows,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    connection.release();
  }
};

// =======================
// POST: ยิง SN (verify)
// =======================
export const scanWarehouseVerify = async (req, res) => {
  const { serial_no, import_log_id } = req.body;
  const userId = req.user.id;
  const warehouseId = req.user.warehouse_id;

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // หา shipment
    const [[shipment]] = await connection.query(
      `SELECT id 
       FROM shipments 
       WHERE serial_no = ? AND import_log_id = ?
       LIMIT 1`,
      [serial_no, import_log_id],
    );

    if (!shipment) {
      throw new Error("ไม่พบ SN ในรายการนี้");
    }

    // หา status
    const [[status]] = await connection.query(
      `SELECT id FROM mm_status WHERE name = 'ตรวจรับเข้าคลัง' LIMIT 1`,
    );

    if (!status) {
      throw new Error("ไม่พบ status ตรวจรับ");
    }

    const VERIFY_STATUS_ID = status.id;

    // กันยิงซ้ำ
    const [[exists]] = await connection.query(
      `SELECT id 
       FROM logs_shipment_status
       WHERE shipment_id = ? AND status_id = ?
       LIMIT 1`,
      [shipment.id, VERIFY_STATUS_ID],
    );

    if (exists) {
      throw new Error("SN นี้ถูกยิงแล้ว");
    }

    // insert log
    await connection.query(
      `INSERT INTO logs_shipment_status
       (shipment_id, status_id, warehouse_id, user_id)
       VALUES (?, ?, ?, ?)`,
      [shipment.id, VERIFY_STATUS_ID, warehouseId, userId],
    );

    await connection.commit();

    res.json({ message: "ยิงสำเร็จ" });
  } catch (err) {
    await connection.rollback();
    res.status(400).json({ message: err.message });
  } finally {
    connection.release();
  }
};
