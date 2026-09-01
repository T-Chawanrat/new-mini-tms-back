import { randomUUID } from "node:crypto";

import db from "../config/db.js";
import { cleanCode, toNumberOrNull } from "../utils/cleanText.js";

const getActorId = (req) => toNumberOrNull(req.user?.id ?? req.user?.user_id);

export const getMoveDcProducts = async (req, res) => {
  try {
    const fromWarehouseId = toNumberOrNull(req.query.from_warehouse_id);
    const toWarehouseId = toNumberOrNull(req.query.to_warehouse_id);
    const actorId = getActorId(req);

    if (!fromWarehouseId) return res.json({ success: true, data: [], draft: [] });

    const [rows] = await db.query(
      `
        SELECT
          product_warehouse.serial_no,
          customer.name AS customer_name,
          receive_serial.recipient_name,
          product_warehouse.to_warehouse_id,
          destination.warehouse_name AS to_warehouse_name
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
          AND NOT EXISTS (
            SELECT 1
            FROM tmp_product_warehouses temp_product
            WHERE temp_product.action_type = 'MOVE_DC'
              AND temp_product.serial_id = product_warehouse.serial_id
              AND temp_product.serial_no = product_warehouse.serial_no
          )
        ORDER BY product_warehouse.id ASC
      `,
      [fromWarehouseId],
    );

    const [draftRows] = actorId && toWarehouseId
      ? await db.query(
          `
            SELECT
              temp_product.serial_no,
              customer.name AS customer_name,
              receive_serial.recipient_name,
              temp_product.to_warehouse_id,
              destination.warehouse_name AS to_warehouse_name
            FROM tmp_product_warehouses temp_product
            LEFT JOIN tm_receive_serials receive_serial
              ON receive_serial.serial_id = temp_product.serial_id
              AND receive_serial.serial_no = temp_product.serial_no
            LEFT JOIN mm_customers customer
              ON customer.id = receive_serial.customer_id
            LEFT JOIN mm_warehouses_to destination
              ON destination.warehouse_id = temp_product.to_warehouse_id
            WHERE temp_product.action_type = 'MOVE_DC'
              AND temp_product.created_by = ?
              AND temp_product.now_warehouse_id = ?
              AND temp_product.to_warehouse_id = ?
            ORDER BY temp_product.id DESC
          `,
          [actorId, fromWarehouseId, toWarehouseId],
        )
      : [[]];

    return res.json({ success: true, data: rows, draft: draftRows });
  } catch (error) {
    console.error("getMoveDcProducts error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดรายการสินค้าในคลังได้" });
  }
};

const createMoveDcDraft = async (req, res) => {
  let connection;

  try {
    const fromWarehouseId = toNumberOrNull(req.body.from_warehouse_id);
    const toWarehouseId = toNumberOrNull(req.body.to_warehouse_id);
    const serialNo = cleanCode(req.body.serial_no);
    const actorId = getActorId(req);

    if (!fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId || !serialNo || !actorId) {
      return res.status(400).json({ success: false, message: "ข้อมูลคลังต้นทาง ปลายทาง หรือ Serial No ไม่ถูกต้อง" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    const now = new Date();
    const [products] = await connection.query(
      `
        SELECT product_warehouse.serial_id, product_warehouse.serial_no
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
      return res.status(404).json({ success: false, message: "ไม่พบ Serial No ในคลังต้นทาง หรือพัสดุปิดงานแล้ว" });
    }

    await connection.query(
      `
        INSERT INTO tmp_product_warehouses (
          tmp_batch_id, action_type, serial_id, serial_no,
          now_warehouse_id, to_warehouse_id, created_by, created_date
        )
        VALUES (?, 'MOVE_DC', ?, ?, ?, ?, ?, ?)
      `,
      [randomUUID(), product.serial_id, product.serial_no, fromWarehouseId, toWarehouseId, actorId, now],
    );

    await connection.commit();
    return res.status(201).json({ success: true, message: "เพิ่ม SN ในรายการรอยืนยันแล้ว" });
  } catch (error) {
    if (connection) await connection.rollback();
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "Serial No นี้อยู่ในรายการรอยืนยันแล้ว" });
    }
    console.error("createMoveDcDraft error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถเพิ่มรายการรอยืนยันได้" });
  } finally {
    connection?.release();
  }
};

const removeMoveDcDraft = async (req, res) => {
  try {
    const fromWarehouseId = toNumberOrNull(req.body.from_warehouse_id);
    const toWarehouseId = toNumberOrNull(req.body.to_warehouse_id);
    const serialNo = cleanCode(req.body.serial_no);
    const actorId = getActorId(req);

    if (!fromWarehouseId || !toWarehouseId || !serialNo || !actorId) {
      return res.status(400).json({ success: false, message: "ข้อมูลรายการรอยืนยันไม่ถูกต้อง" });
    }

    const [result] = await db.query(
      `
        DELETE FROM tmp_product_warehouses
        WHERE action_type = 'MOVE_DC'
          AND serial_no = ?
          AND created_by = ?
          AND now_warehouse_id = ?
          AND to_warehouse_id = ?
      `,
      [serialNo, actorId, fromWarehouseId, toWarehouseId],
    );

    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: "ไม่พบ Serial No ในรายการรอยืนยัน" });
    }

    return res.json({ success: true, message: "นำ SN กลับไปรายการต้นทางแล้ว" });
  } catch (error) {
    console.error("removeMoveDcDraft error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถนำรายการกลับไปรายการต้นทางได้" });
  }
};

const confirmMoveDc = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const fromWarehouseId = toNumberOrNull(req.body.from_warehouse_id);
    const toWarehouseId = toNumberOrNull(req.body.to_warehouse_id);
    const actorId = getActorId(req);

    if (!fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId || !actorId) {
      return res.status(400).json({ success: false, message: "ข้อมูลคลังต้นทางหรือปลายทางไม่ถูกต้อง" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const now = new Date();
    const [draftRows] = await connection.query(
      `
        SELECT id, serial_id, serial_no
        FROM tmp_product_warehouses
        WHERE action_type = 'MOVE_DC'
          AND created_by = ?
          AND now_warehouse_id = ?
          AND to_warehouse_id = ?
        ORDER BY id ASC
        FOR UPDATE
      `,
      [actorId, fromWarehouseId, toWarehouseId],
    );

    if (!draftRows.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(400).json({ success: false, message: "ยังไม่มีรายการรอยืนยัน" });
    }

    const serialNos = draftRows.map((row) => String(row.serial_no));
    const placeholders = serialNos.map(() => "?").join(", ");
    const [products] = await connection.query(
      `
        SELECT product_warehouse.id
        FROM tm_product_warehouses product_warehouse
        INNER JOIN tm_product_actived product_active
          ON product_active.serial_id = product_warehouse.serial_id
          AND product_active.serial_no = product_warehouse.serial_no
        WHERE product_warehouse.serial_no IN (${placeholders})
          AND product_warehouse.now_warehouse_id = ?
        FOR UPDATE
      `,
      [...serialNos, fromWarehouseId],
    );

    if (products.length !== draftRows.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ success: false, message: "มีบาง Serial No ไม่ได้อยู่ในคลังต้นทางแล้ว กรุณาโหลดรายการใหม่" });
    }

    await connection.query(
      `
        UPDATE tm_product_warehouses product_warehouse
        INNER JOIN tmp_product_warehouses temp_product
          ON temp_product.serial_id = product_warehouse.serial_id
          AND temp_product.serial_no = product_warehouse.serial_no
        SET
          product_warehouse.now_warehouse_id = temp_product.to_warehouse_id,
          product_warehouse.to_warehouse_id = temp_product.to_warehouse_id
        WHERE temp_product.action_type = 'MOVE_DC'
          AND temp_product.created_by = ?
          AND temp_product.now_warehouse_id = ?
          AND temp_product.to_warehouse_id = ?
          AND product_warehouse.now_warehouse_id = ?
      `,
      [actorId, fromWarehouseId, toWarehouseId, fromWarehouseId],
    );

    await connection.query(
      `
        INSERT INTO logs_product_warehouses (
          product_warehouse_id, serial_id, serial_no, event_type,
          now_warehouse_id, to_warehouse_id, created_by, created_date
        )
        SELECT
          product_warehouse.id,
          product_warehouse.serial_id,
          product_warehouse.serial_no,
          'MOVE_DC',
          temp_product.now_warehouse_id,
          temp_product.to_warehouse_id,
          ?,
          ?
        FROM tmp_product_warehouses temp_product
        INNER JOIN tm_product_warehouses product_warehouse
          ON product_warehouse.serial_id = temp_product.serial_id
          AND product_warehouse.serial_no = temp_product.serial_no
        WHERE temp_product.action_type = 'MOVE_DC'
          AND temp_product.created_by = ?
          AND temp_product.now_warehouse_id = ?
          AND temp_product.to_warehouse_id = ?
      `,
      [actorId, now, actorId, fromWarehouseId, toWarehouseId],
    );

    await connection.query(
      `
        DELETE FROM tmp_product_warehouses
        WHERE action_type = 'MOVE_DC'
          AND created_by = ?
          AND now_warehouse_id = ?
          AND to_warehouse_id = ?
      `,
      [actorId, fromWarehouseId, toWarehouseId],
    );

    await connection.commit();
    transactionStarted = false;
    return res.json({ success: true, message: "ย้ายสินค้าไปคลังปลายทางสำเร็จ", moved: draftRows.length });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    console.error("confirmMoveDc error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถย้ายสินค้าไปคลังปลายทางได้" });
  } finally {
    connection?.release();
  }
};

export const moveDcProduct = async (req, res) => {
  const action = String(req.body.action || "").trim().toUpperCase();
  if (action === "DRAFT") return createMoveDcDraft(req, res);
  if (action === "REMOVE") return removeMoveDcDraft(req, res);
  if (action === "CONFIRM") return confirmMoveDc(req, res);
  return res.status(400).json({ success: false, message: "รูปแบบการย้ายคลังไม่ถูกต้อง" });
};
