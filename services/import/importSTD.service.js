import db from "../../config/db.js";

import { formatDateOnly } from "../../utils/formatDate.js";
import { cleanTel } from "../../utils/cleanTel.js";

import { createImportLog } from "./createImportLog.service.js";
import { loadAddressMap } from "./loadAddressMap.service.js";
import { insertShipmentStatus } from "./insertShipmentStatus.service.js";

export const importSTDService = async (req) => {
  let connection;

  try {
    if (!req.user) {
      throw new Error("unauthorized");
    }

    const { rows, file_name } = req.body;

    const {
      id: userId,
      role_id: roleId,
      customer_id: customerId,
    } = req.user;

    if (roleId === 2 && !customerId) {
      throw new Error("customer_id missing");
    }

    if (!rows?.length) {
      throw new Error("no rows");
    }

    const customerIdValue = roleId === 2 ? customerId : null;

    connection = await db.getConnection();

    await connection.beginTransaction();

    // =====================
    // CREATE IMPORT LOG
    // =====================

    const importLogId = await createImportLog(connection, {
      userId,
      customerId: customerIdValue,
      importType: "STD",
      fileName: file_name,
      totalRows: rows.length,
    });

    // =====================
    // LOAD ADDRESS MAP
    // =====================

    const subdistrictMap = await loadAddressMap(connection);

    // =====================
    // VALIDATE + MAP
    // =====================

    const values = [];
    const errorLogs = [];

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

      const warehouseId = subdistrictMap[r.subdistrict_id];

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

    // =====================
    // INSERT SHIPMENTS
    // =====================

    let totalInserted = 0;

    if (values.length) {
      const [result] = await connection.query(
        `
        INSERT INTO shipments (
          no_bill, serial_no, receive_code, reference, send_date,
          customer_id, shipper_code, recipient_code,
          recipient_name, recipient_tel,
          address, subdistrict, district, province, zipcode,
          subdistrict_id, warehouse_id,
          package_code, weight, width, height, length, q,
          import_log_id, current_status_id, import_type, source_id, created_by
        )
        VALUES ?
        `,
        [values],
      );

      totalInserted = result.affectedRows;
    }

    // =====================
    // STATUS LOG
    // =====================

    if (totalInserted) {
      await insertShipmentStatus(connection, {
        importLogId,
        userId,
      });
    }

    // =====================
    // ERROR LOG
    // =====================

    if (errorLogs.length) {
      await connection.query(
        `
        INSERT INTO logs_import_errors (
          import_log_id,
          row_no,
          error_code,
          error_message,
          raw_data
        )
        VALUES ?
        `,
        [errorLogs],
      );
    }

    // =====================
    // UPDATE SUMMARY
    // =====================

    await connection.query(
      `
      UPDATE logs_imports
      SET success_rows = ?, failed_rows = ?
      WHERE id = ?
      `,
      [totalInserted, errorLogs.length, importLogId],
    );

    await connection.commit();

    connection.release();

    return {
      message: "นำเข้าสำเร็จ",
      import_log_id: importLogId,
      total: totalInserted,
      failed: errorLogs.length,
    };
  } catch (err) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }

    throw err;
  }
};