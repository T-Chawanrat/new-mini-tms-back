import db from "../config/db.js";
import { formatDateOnly } from "../utils/formatDate.js";
import { cleanTel } from "../utils/cleanTel.js";


export const importCustomerSTD = async (req, res) => {
  let connection;

  try {
    if (!req.user) return res.status(401).json({ message: "unauthorized" });

    const { rows, file_name } = req.body;
    const { id: userId, customer_id: customerId } = req.user;

    const customerIdValue = Number(customerId);

    if (!customerIdValue) {
      return res.status(400).json({ message: "customer_id missing" });
    }

    if (!rows?.length) {
      return res.status(400).json({ message: "no rows" });
    }

    console.log("CUSTOMER IMPORT BODY =", {
      file_name: req.body.file_name,
      rows_count: Array.isArray(req.body.rows) ? req.body.rows.length : null,
    });

    console.log("CUSTOMER IMPORT USER =", {
      id: req.user?.id,
      role_id: req.user?.role_id,
      token_customer_id: req.user?.customer_id,
    });

    connection = await db.getConnection();
    await connection.beginTransaction();

    // ===== CREATE LOG =====
    const [logResult] = await connection.query(
      `INSERT INTO logs_imports 
      (user_id, customer_id, import_type, input_type, file_name, total_rows, success_rows, failed_rows)
      VALUES (?, ?, 'STD', 'EXCEL', ?, ?, 0, 0)`,
      [userId, customerIdValue, file_name || null, rows.length],
    );

    const importLogId = logResult.insertId;

    // ===== VALIDATE =====
    const values = [];
    const errorLogs = [];

    // ===== LOAD ADDRESS MAPPING =====
    const [addrRows] = await connection.query(
      `SELECT subdistrict_id, warehouse_id FROM mm_master_addresses`,
    );

    // map: subdistrict_id → warehouse_id
    const subdistrictMap = {};
    addrRows.forEach((r) => {
      subdistrictMap[r.subdistrict_id] = r.warehouse_id;
    });

    rows.forEach((r, index) => {
      if (!r.SERIAL_NO) {
        return errorLogs.push([
          importLogId,
          index + 1,
          "REQUIRED_SERIAL",
          "SERIAL_NO is required",
          JSON.stringify(r),
        ]);
      }

      const tel = cleanTel(r.RECIPIENT_TEL);

      if (tel && !/^\d{9,10}$/.test(tel)) {
        return errorLogs.push([
          importLogId,
          index + 1,
          "INVALID_TEL",
          "เบอร์โทรไม่ถูกต้อง",
          JSON.stringify(r),
        ]);
      }

      if (!subdistrictMap[r.subdistrict_id]) {
        return errorLogs.push([
          importLogId,
          index + 1,
          "INVALID_SUBDISTRICT",
          "ไม่พบ subdistrict_id ใน master",
          JSON.stringify(r),
        ]);
      }

      const warehouseId = subdistrictMap[r.subdistrict_id] || null;

      values.push([
        r.NO_BILL || null,
        r.SERIAL_NO,
        null,
        r.REFERENCE,
        formatDateOnly(r.SEND_DATE),

        customerIdValue,

        r.SHIPPER_CODE || null,
        r.RECIPIENT_CODE || null,
        r.RECIPIENT_NAME,
        tel,
        r.RECIPIENT_ADDRESS,
        r.RECIPIENT_SUBDISTRICT,
        r.RECIPIENT_DISTRICT,
        r.RECIPIENT_PROVINCE,
        r.RECIPIENT_ZIPCODE,
        r.subdistrict_id || null,
        warehouseId,
        r.PACKAGE_CODE || null,
        r.WEIGHT || null,
        r.WIDTH || null,
        r.HEIGHT || null,
        r.LENGTH || null,
        r.Q || null,
        importLogId,
        1,
        "STD",
        importLogId,
        userId,
      ]);
    });

    // ===== INSERT SHIPMENTS =====
    const chunkSize = 500;
    let insertIdStart = null;
    let totalInserted = 0;

    for (let i = 0; i < values.length; i += chunkSize) {
      const chunk = values.slice(i, i + chunkSize);

      const [result] = await connection.query(
        `INSERT INTO shipments (
          no_bill, serial_no, receive_code, reference, send_date,
          customer_id, shipper_code, recipient_code,
          recipient_name, recipient_tel,
          address, subdistrict, district, province, zipcode,
          subdistrict_id, warehouse_id,
          package_code, weight, width, height, length, q,
          import_log_id, current_status_id, import_type, source_id, created_by
        ) VALUES ?`,
        [chunk],
      );

      if (!insertIdStart) insertIdStart = result.insertId;
      totalInserted += result.affectedRows;
    }

    // ===== STATUS LOG =====
    if (totalInserted) {
      const [rows] = await connection.query(
        `SELECT id, warehouse_id 
         FROM shipments 
         WHERE import_log_id = ?
         ORDER BY id`,
        [importLogId],
      );

      const [[status]] = await connection.query(
        `SELECT id FROM mm_status WHERE name = 'รับเข้าระบบ' LIMIT 1`,
      );

      const IMPORT_STATUS_ID = status.id;

      const statusLogs = rows.map((r) => [
        r.id,
        IMPORT_STATUS_ID,
        r.warehouse_id,
        userId,
      ]);

      await connection.query(
        `INSERT INTO logs_shipment_status 
         (shipment_id, status_id, warehouse_id, user_id) VALUES ?`,
        [statusLogs],
      );
    }

    // ===== ERROR LOG =====
    if (errorLogs.length) {
      await connection.query(
        `INSERT INTO logs_import_errors 
        (import_log_id, row_no, error_code, error_message, raw_data) VALUES ?`,
        [errorLogs],
      );
    }

    // ===== SUMMARY =====
    await connection.query(
      `UPDATE logs_imports 
       SET success_rows = ?, failed_rows = ? WHERE id = ?`,
      [totalInserted, errorLogs.length, importLogId],
    );

    await connection.commit();
    connection.release();

    return res.json({
      message: "นำเข้าสำเร็จ",
      import_log_id: importLogId,
      total: totalInserted,
      failed: errorLogs.length,
    });
  } catch (err) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }

    return res.status(500).json({ message: err.message });
  }
};