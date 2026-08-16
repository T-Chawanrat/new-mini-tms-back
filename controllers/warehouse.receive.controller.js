import db from "../config/db.js";
import { cleanCode, toNumberOrNull } from "../utils/cleanText.js";
import { formatDateOnly } from "../utils/formatDate.js";

export const getWarehouseReceiveSerials = async (req, res) => {
  try {
    const customerId = toNumberOrNull(req.query.customer_id);

    const where = [];
    const params = [];

    if (customerId !== null) {
      where.push("product_customer.customer_id = ?");
      params.push(customerId);
    }

    const sql = `
      SELECT
        product_customer.serial_id,
        product_customer.serial_no,
        product_customer.customer_id,
        c.name AS customer_name,
        product_customer.to_warehouse_id,
        wt.warehouse_name AS to_warehouse_name
      FROM tm_product_customers product_customer

      LEFT JOIN mm_customers c
        ON c.id = product_customer.customer_id

      LEFT JOIN mm_warehouses_to wt
        ON wt.warehouse_id = product_customer.to_warehouse_id

      WHERE NULLIF(TRIM(product_customer.serial_no), '') IS NOT NULL

        ${where.length ? `AND ${where.join("\n        AND ")}` : ""}

      ORDER BY
        c.name ASC,
        wt.warehouse_name ASC,
        product_customer.serial_no ASC
    `;

    const [rows] = await db.query(sql, params);

    return res.status(200).json({
      success: true,
      total: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("getWarehouseReceiveSerials error:", error);

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถโหลดข้อมูล Serial No ได้",
      error: error.message,
    });
  }
};

export const createWarehouseReceive = async (req, res) => {
  let connection;

  try {
    const serialNos = Array.isArray(req.body.serial_nos)
      ? [...new Set(req.body.serial_nos.map((value) => cleanCode(value)).filter((value) => value !== null))]
      : [];

    if (!serialNos.length) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุ Serial No ที่ต้องการรับเข้าคลัง",
      });
    }

    const createdBy = toNumberOrNull(req.user?.id);
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);
    const resendDate = formatDateOnly(req.body.resend_date);

    if (createdBy === null) {
      return res.status(401).json({
        success: false,
        message: "ไม่พบข้อมูลผู้ใช้งาน",
      });
    }

    if (warehouseId === null) {
      return res.status(400).json({
        success: false,
        message: "ผู้ใช้งานยังไม่ได้กำหนดคลัง",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    const now = new Date();
    const dataYear = now.getFullYear();
    const dataYearmonth = dataYear * 100 + now.getMonth() + 1;

    const placeholders = serialNos.map(() => "?").join(", ");

    /*
     * tm_product_customers เป็นรายการรอรับและมีข้อมูลที่ต้องใช้สำหรับย้ายเข้าคลังครบแล้ว
     */
    const [serialRows] = await connection.query(
      `
        SELECT DISTINCT
          product_customer.serial_id,
          product_customer.serial_no,
          product_customer.to_warehouse_id
        FROM tm_product_customers product_customer
        WHERE product_customer.serial_no IN (${placeholders})
      `,
      serialNos,
    );

    const foundSet = new Set(serialRows.map((row) => String(row.serial_no ?? "").trim()));

    const notFoundSerialNos = serialNos.filter((serialNo) => !foundSet.has(serialNo));

    if (notFoundSerialNos.length > 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "พบ Serial No ที่ไม่มีอยู่ในระบบ",
        not_found_serial_nos: notFoundSerialNos,
      });
    }

    /*
     * ตรวจสอบว่ารับเข้าคลังไปแล้วหรือยัง
     */
    const [existingRows] = await connection.query(
      `
        SELECT DISTINCT
          pw.serial_no
        FROM tm_product_warehouses pw
        WHERE pw.serial_no IN (${placeholders})
      `,
      serialNos,
    );

    if (existingRows.length > 0) {
      const alreadyReceivedSerialNos = existingRows.map((row) => String(row.serial_no ?? "").trim());

      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "พบ Serial No ที่รับเข้าคลังไปแล้ว",
        already_received_serial_nos: alreadyReceivedSerialNos,
      });
    }

    /*
     * now_warehouse_id = คลังปัจจุบันของผู้ใช้งาน
     * to_warehouse_id  = คลังปลายทางจาก tm_product_customers
     */
    const values = serialRows.map((row) => [
      row.serial_id,
      row.serial_no,
      warehouseId,
      toNumberOrNull(row.to_warehouse_id),
      null,
      null,
      resendDate,
      createdBy,
      now,
    ]);

    const [result] = await connection.query(
      `
        INSERT INTO tm_product_warehouses (
          serial_id,
          serial_no,
          now_warehouse_id,
          to_warehouse_id,
          palette_id,
          route_id,
          resend_date,
          created_by,
          created_date
        )
        VALUES ?
      `,
      [values],
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
        SELECT
          pw.id,
          pw.serial_id,
          pw.serial_no,
          'RECEIVE_IN',
          pw.now_warehouse_id,
          pw.to_warehouse_id,
          ?,
          ?
        FROM tm_product_warehouses pw
        WHERE pw.serial_no IN (${placeholders})
      `,
      [createdBy, now, ...serialNos],
    );

    await connection.query(
      `
        INSERT INTO tm_product_transactions (
          receive_business_id, receive_walkin_id, receive_code, serial_id, serial_no,
          status_message, status_id, datetime, update_date, type,
          warehouse_id, created_by, latitude, longitude, warehouse_name,
          address, province_name, district_name, subdistrict_name, zip_code,
          created_name, username, truck_license_plate, user_id, user_truck_id,
          truck_name, truck_id, vehicle_contractor_id, truck_province, note,
          data_year, data_yearmonth
        )
        SELECT
          transaction_last.receive_business_id,
          transaction_last.receive_walkin_id,
          transaction_last.receive_code,
          transaction_last.serial_id,
          transaction_last.serial_no,
          'พัสดุถึงศูนย์', 4, ?, NULL, 'PUBLIC',
          ?, actor.id, transaction_last.latitude, transaction_last.longitude, warehouse.warehouse_name,
          transaction_last.address, transaction_last.province_name, transaction_last.district_name,
          transaction_last.subdistrict_name, transaction_last.zip_code,
          TRIM(CONCAT_WS(' ', NULLIF(actor.first_name, ''), NULLIF(actor.last_name, ''))),
          actor.username, transaction_last.truck_license_plate, actor.id, transaction_last.user_truck_id,
          transaction_last.truck_name, transaction_last.truck_id, transaction_last.vehicle_contractor_id,
          transaction_last.truck_province, transaction_last.note, ?, ?
        FROM tm_product_transactions_last transaction_last
        INNER JOIN um_users actor
          ON actor.id = ?
        LEFT JOIN mm_warehouses_to warehouse
          ON warehouse.warehouse_id = ?
        WHERE transaction_last.serial_no IN (${placeholders})
      `,
      [now, warehouseId, createdBy, dataYear, dataYearmonth, createdBy, warehouseId, ...serialNos],
    );

    await connection.query(
      `
        UPDATE tm_product_transactions_last transaction_last
        INNER JOIN um_users actor
          ON actor.id = ?
        LEFT JOIN mm_warehouses_to warehouse
          ON warehouse.warehouse_id = ?
        SET
          transaction_last.status_message = 'พัสดุถึงศูนย์',
          transaction_last.status_id = 4,
          transaction_last.datetime = ?,
          transaction_last.update_date = ?,
          transaction_last.type = 'PUBLIC',
          transaction_last.warehouse_id = ?,
          transaction_last.created_by = ?,
          transaction_last.warehouse_name = warehouse.warehouse_name,
          transaction_last.created_name = TRIM(
            CONCAT_WS(
              ' ',
              NULLIF(actor.first_name, ''),
              NULLIF(actor.last_name, '')
            )
          ),
          transaction_last.username = actor.username,
          transaction_last.user_id = actor.id

        WHERE transaction_last.serial_no IN (${placeholders})
      `,
      [createdBy, warehouseId, now, now, warehouseId, createdBy, ...serialNos],
    );

    await connection.query(
      `
        DELETE product_customer
        FROM tm_product_customers product_customer
        INNER JOIN tm_product_warehouses product_warehouse
          ON product_warehouse.serial_id = product_customer.serial_id
          AND product_warehouse.serial_no = product_customer.serial_no
        WHERE product_customer.serial_no IN (${placeholders})
      `,
      serialNos,
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "บันทึกรับสินค้าเข้าคลังสำเร็จ",
      inserted: result.affectedRows,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("createWarehouseReceive rollback error:", rollbackError);
      }
    }

    console.error("createWarehouseReceive error:", error);

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถบันทึกรับสินค้าเข้าคลังได้",
      error: error.message,
    });
  } finally {
    connection?.release();
  }
};
