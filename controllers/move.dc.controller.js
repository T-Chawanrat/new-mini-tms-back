import db from "../config/db.js";
import { cleanCode, toNumberOrNull } from "../utils/cleanText.js";

const getActorId = (req) => toNumberOrNull(req.user?.id ?? req.user?.user_id);

export const getMoveDcProducts = async (req, res) => {
  try {
    const warehouseId = toNumberOrNull(req.query.from_warehouse_id);

    if (!warehouseId) {
      return res.status(200).json({ success: true, data: [] });
    }

    const [rows] = await db.query(
      `
        SELECT
          product_warehouse.serial_no,
          customer.name AS customer_name,
          receive_serial.recipient_name,
          product_warehouse.to_warehouse_id,
          destination.warehouse_name AS to_warehouse_name,
          product_warehouse.route_id
        FROM tm_product_warehouses product_warehouse
        INNER JOIN tm_product_actived product_active
          ON product_active.serial_id = product_warehouse.serial_id
          AND product_active.serial_no = product_warehouse.serial_no
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_warehouse.serial_id
          AND receive_serial.serial_no = product_warehouse.serial_no
        LEFT JOIN mm_customers customer
          ON customer.id = receive_serial.customer_id
        LEFT JOIN mm_warehouses_to destination
          ON destination.warehouse_id = product_warehouse.to_warehouse_id
        WHERE product_warehouse.now_warehouse_id = ?
          AND NULLIF(TRIM(product_warehouse.serial_no), '') IS NOT NULL
        ORDER BY product_warehouse.id ASC
      `,
      [warehouseId],
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getMoveDcProducts error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดรายการสินค้าในคลังได้" });
  }
};

export const moveDcProduct = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const fromWarehouseId = toNumberOrNull(req.body.from_warehouse_id);
    const toWarehouseId = toNumberOrNull(req.body.to_warehouse_id);
    const serialNo = cleanCode(req.body.serial_no);
    const actorId = getActorId(req);

    if (!fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId || !serialNo) {
      return res.status(400).json({ success: false, message: "ข้อมูลคลังต้นทาง ปลายทาง หรือ Serial No ไม่ถูกต้อง" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [products] = await connection.query(
      `
        SELECT
          product_warehouse.id,
          product_warehouse.serial_id,
          product_warehouse.serial_no
        FROM tm_product_warehouses product_warehouse
        INNER JOIN tm_product_actived product_active
          ON product_active.serial_id = product_warehouse.serial_id
          AND product_active.serial_no = product_warehouse.serial_no
        WHERE product_warehouse.serial_no = ?
          AND product_warehouse.now_warehouse_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [serialNo, fromWarehouseId],
    );

    const product = products[0];

    if (!product) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ success: false, message: "ไม่พบ Serial No ในคลังต้นทาง หรือพัสดุปิดงานแล้ว" });
    }

    await connection.query(
      "UPDATE tm_product_warehouses SET now_warehouse_id = ? WHERE id = ?",
      [toWarehouseId, product.id],
    );

    await connection.query(
      `
        INSERT INTO logs_product_warehouses (
          product_warehouse_id,
          serial_id,
          serial_no,
          event_type,
          now_warehouse_id,
          to_warehouse_id,
          created_by,
          created_date
        )
        VALUES (?, ?, ?, 'MOVE_DC', ?, ?, ?, NOW())
      `,
      [product.id, product.serial_id, product.serial_no, fromWarehouseId, toWarehouseId, actorId],
    );

    await connection.commit();
    transactionStarted = false;
    return res.json({ success: true, message: `ย้าย SN ${serialNo} ไปคลังปลายทางสำเร็จ` });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    console.error("moveDcProduct error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถย้ายสินค้าไปคลังปลายทางได้" });
  } finally {
    connection?.release();
  }
};
