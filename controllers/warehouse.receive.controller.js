import db from "../config/db.js";
import { cleanCode, toNumberOrNull } from "../utils/cleanText.js";
import { formatDateOnly } from "../utils/formatDate.js";

export const getWarehouseReceiveSerials = async (req, res) => {
  try {
    const customerId = toNumberOrNull(req.query.customer_id);
    const toWarehouseId = toNumberOrNull(req.query.to_warehouse_id);

    const where = [];
    const params = [];

    if (customerId !== null) {
      where.push("rs.customer_id = ?");
      params.push(customerId);
    }

    if (toWarehouseId !== null) {
      where.push("rs.to_warehouse_id = ?");
      params.push(toWarehouseId);
    }

    const sql = `
      SELECT
        rs.serial_no,
        rs.customer_id,
        c.name AS customer_name,
        rs.to_warehouse_id,
        wt.warehouse_name AS to_warehouse_name
      FROM tm_receive_serials rs

      INNER JOIN tm_product_transactions_last transaction_last
        ON transaction_last.serial_id = rs.serial_id
        AND transaction_last.serial_no = rs.serial_no
        AND transaction_last.status_id = 1

      LEFT JOIN mm_customers c
        ON c.id = rs.customer_id

      LEFT JOIN mm_warehouses_to wt
        ON wt.warehouse_id = rs.to_warehouse_id

      WHERE NULLIF(TRIM(rs.serial_no), '') IS NOT NULL

        ${where.length ? `AND ${where.join("\n        AND ")}` : ""}

      ORDER BY
        c.name ASC,
        wt.warehouse_name ASC,
        rs.serial_no ASC
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

    const placeholders = serialNos.map(() => "?").join(", ");

    /*
     * ดึง Serial พร้อมคลังปลายทางจาก tm_receive_serials
     */
    const [serialRows] = await connection.query(
      `
        SELECT DISTINCT
          rs.serial_id,
          rs.serial_no,
          rs.to_warehouse_id
        FROM tm_receive_serials rs
        WHERE rs.serial_no IN (${placeholders})
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
     * to_warehouse_id  = คลังปลายทางจาก tm_receive_serials
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
          created_by
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
          NOW()
        FROM tm_product_warehouses pw
        WHERE pw.serial_no IN (${placeholders})
      `,
      [createdBy, ...serialNos],
    );

    /*
     * บันทึกประวัติ Transaction
     * warehouse_id ตรงนี้ไม่ต้องเปลี่ยน เพราะเป็นคอลัมน์ของ
     * tm_product_transactions ไม่ใช่ tm_product_warehouses
     */
    await connection.query(
      `
        INSERT INTO tm_product_transactions (
          receive_business_id,
          receive_walkin_id,
          receive_code,
          serial_id,
          serial_no,
          status_message,
          status_id,
          datetime,
          update_date,
          type,
          warehouse_id,
          created_by,
          latitude,
          longitude,
          warehouse_name,
          address,
          province_name,
          district_name,
          subdistrict_name,
          zip_code,
          created_name,
          username,
          truck_license_plate,
          user_id,
          truck_name,
          truck_id,
          truck_province,
          note,
          data_year,
          data_yearmonth
        )
        SELECT
          rs.receive_business_id,
          rs.receive_walkin_id,
          rs.receive_code,
          rs.serial_id,
          rs.serial_no,
          'พัสดุถึงศูนย์',
          4,
          NOW(),
          NULL,
          'PUBLIC',
          ?,
          ?,
          NULL,
          NULL,
          warehouse.warehouse_name,
          rs.address,
          rs.province_name,
          rs.district_name,
          rs.subdistrict_name,
          rs.zip_code,
          TRIM(
            CONCAT_WS(
              ' ',
              NULLIF(actor.first_name, ''),
              NULLIF(actor.last_name, '')
            )
          ),
          actor.username,
          NULL,
          actor.id,
          NULL,
          NULL,
          NULL,
          NULL,
          YEAR(NOW()),
          CAST(DATE_FORMAT(NOW(), '%Y%m') AS UNSIGNED)
        FROM tm_receive_serials rs

        INNER JOIN um_users actor
          ON actor.id = ?

        LEFT JOIN mm_warehouses_to warehouse
          ON warehouse.warehouse_id = ?

        WHERE rs.serial_no IN (${placeholders})
      `,
      [warehouseId, createdBy, createdBy, warehouseId, ...serialNos],
    );

    /*
     * อัปเดต Transaction ล่าสุด
     * warehouse_id ตรงนี้ก็ยังเป็นของ tm_product_transactions_last
     */
    await connection.query(
      `
        UPDATE tm_product_transactions_last transaction_last

        INNER JOIN tm_receive_serials rs
          ON rs.serial_id = transaction_last.serial_id
          AND rs.serial_no = transaction_last.serial_no

        INNER JOIN um_users actor
          ON actor.id = ?

        LEFT JOIN mm_warehouses_to warehouse
          ON warehouse.warehouse_id = ?

        SET
          transaction_last.status_message = 'พัสดุถึงศูนย์',
          transaction_last.status_id = 4,
          transaction_last.datetime = NOW(),
          transaction_last.update_date = NOW(),
          transaction_last.type = 'PUBLIC',
          transaction_last.warehouse_id = ?,
          transaction_last.created_by = ?,
          transaction_last.warehouse_name = warehouse.warehouse_name,
          transaction_last.address = rs.address,
          transaction_last.province_name = rs.province_name,
          transaction_last.district_name = rs.district_name,
          transaction_last.subdistrict_name = rs.subdistrict_name,
          transaction_last.zip_code = rs.zip_code,
          transaction_last.created_name = TRIM(
            CONCAT_WS(
              ' ',
              NULLIF(actor.first_name, ''),
              NULLIF(actor.last_name, '')
            )
          ),
          transaction_last.username = actor.username,
          transaction_last.user_id = actor.id

        WHERE rs.serial_no IN (${placeholders})
      `,
      [createdBy, warehouseId, warehouseId, createdBy, ...serialNos],
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
