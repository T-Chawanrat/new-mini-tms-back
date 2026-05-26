import db from "../config/db.js";
// import { importSTDService } from "../services/import/importSTD.service.js";
import { formatDateOnly } from "../utils/formatDate.js";
import { cleanTel } from "../utils/cleanTel.js";

export const importSTD = async (req, res) => {
  let connection;

  try {
    if (!req.user) return res.status(401).json({ message: "unauthorized" });

    const { rows, file_name, customer_id } = req.body;
    const { id: userId } = req.user;

    const customerIdValue = Number(customer_id);

    if (!customerIdValue) {
      return res.status(400).json({ message: "กรุณาเลือกลูกค้า" });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "no rows" });
    }

    console.log("IMPORT BODY =", {
      customer_id,
      file_name,
      rows_count: rows.length,
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

    // map: subdistrict_id → to_warehouse
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

      const fromWarehouse = null;
      const toWarehouse = subdistrictMap[r.subdistrict_id] || null;

      values.push([
        r.NO_BILL || null,
        r.SERIAL_NO,
        null,
        r.REFERENCE,
        formatDateOnly(r.SEND_DATE),

        customerIdValue,

        r.SHIPPER_CODE || null,
        null, // shipper_id: ไว้ lookup ทีหลัง

        r.RECIPIENT_CODE || null,
        null, // recipient_id: ไว้ lookup ทีหลัง

        r.RECIPIENT_NAME,
        tel,
        r.RECIPIENT_ADDRESS,
        r.RECIPIENT_SUBDISTRICT,
        r.RECIPIENT_DISTRICT,
        r.RECIPIENT_PROVINCE,
        r.RECIPIENT_ZIPCODE,

        r.subdistrict_id || null,
        fromWarehouse,
        toWarehouse,

        r.PACKAGE_CODE || null,
        null, // package_id: ไว้ lookup ทีหลัง

        r.WEIGHT || null,
        r.WIDTH || null,
        r.HEIGHT || null,
        r.LENGTH || null,
        r.Q || null,

        null, // price: ไว้คำนวณทีหลัง

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
          no_bill,
          serial_no,
          receive_code,
          reference,
          send_date,
          customer_id,
          shipper_code,
          shipper_id,
          recipient_code,
          recipient_id,
          recipient_name,
          recipient_tel,
          address,
          subdistrict,
          district,
          province,
          zipcode,
          subdistrict_id,
          from_warehouse,
          to_warehouse,
          package_code,
          package_id,
          weight,
          width,
          height,
          length,
          q,
          price,
          import_log_id,
          current_status_id,
          import_type,
          source_id,
          created_by
        ) VALUES ?`,
        [chunk],
      );

      if (!insertIdStart) insertIdStart = result.insertId;
      totalInserted += result.affectedRows;
    }

    // ===== STATUS LOG =====
    if (totalInserted) {
      const [rows] = await connection.query(
        `SELECT id, to_warehouse 
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
        r.to_warehouse,
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
      success: totalInserted > 0,
      message:
        errorLogs.length > 0
          ? `นำเข้าสำเร็จ ${totalInserted} รายการ, ไม่สำเร็จ ${errorLogs.length} รายการ`
          : "นำเข้าสำเร็จ",
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

export const manual = async (req, res) => {
  let connection;

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { rows, file_name } = req.body;
    const { id: userId, role_id: roleId, customer_id: tokenCustomerId } = req.user;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "no rows" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // ===== CREATE IMPORT LOG =====
    const [logResult] = await connection.query(
      `
      INSERT INTO logs_imports (
        user_id,
        customer_id,
        import_type,
        input_type,
        file_name,
        total_rows,
        success_rows,
        failed_rows
      )
      VALUES (?, ?, 'STD', 'MANUAL', ?, ?, 0, 0)
      `,
      [
        userId,
        roleId === 2 ? tokenCustomerId : null,
        file_name || "manual-input",
        rows.length,
      ],
    );

    const importLogId = logResult.insertId;

    // ===== LOAD ADDRESS MAP =====
    const [addrRows] = await connection.query(
      `
      SELECT subdistrict_id, warehouse_id
      FROM mm_master_addresses
      `,
    );

    const subdistrictMap = {};
    addrRows.forEach((r) => {
      subdistrictMap[String(r.subdistrict_id)] = r.warehouse_id;
    });

    // ===== LOAD STATUS =====
    const [[statusRow]] = await connection.query(
      `
      SELECT id
      FROM mm_status
      WHERE name = 'รับเข้าระบบ'
      LIMIT 1
      `,
    );

    if (!statusRow) {
      throw new Error("ไม่พบสถานะ รับเข้าระบบ ใน mm_status");
    }

    const importStatusId = statusRow.id;

    const values = [];
    const errorLogs = [];

    rows.forEach((r, index) => {
      const rowNo = index + 1;

      const serialNo = (r.serial_no || "").toString().trim();
      const reference = (r.reference || "").toString().trim();
      const sendDate = formatDateOnly(r.send_date);

      const recipientName = (r.recipient_name || "").toString().trim();
      const recipientTel = cleanTel(r.recipient_tel);

      const address = (r.address || "").toString().trim();
      const subdistrict = (r.subdistrict || "").toString().trim();
      const district = (r.district || "").toString().trim();
      const province = (r.province || "").toString().trim();
      const zipcode = (r.zipcode || "").toString().trim();

      const subdistrictId = r.subdistrict_id ? String(r.subdistrict_id) : "";

      if (!serialNo) {
        errorLogs.push([
          importLogId,
          rowNo,
          "REQUIRED_SERIAL",
          "serial_no is required",
          JSON.stringify(r),
        ]);
        return;
      }

      if (!reference) {
        errorLogs.push([
          importLogId,
          rowNo,
          "REQUIRED_REFERENCE",
          "reference is required",
          JSON.stringify(r),
        ]);
        return;
      }

      if (!sendDate) {
        errorLogs.push([
          importLogId,
          rowNo,
          "REQUIRED_SEND_DATE",
          "send_date is required",
          JSON.stringify(r),
        ]);
        return;
      }

      if (!recipientName) {
        errorLogs.push([
          importLogId,
          rowNo,
          "REQUIRED_RECIPIENT_NAME",
          "recipient_name is required",
          JSON.stringify(r),
        ]);
        return;
      }

      if (!recipientTel) {
        errorLogs.push([
          importLogId,
          rowNo,
          "REQUIRED_TEL",
          "recipient_tel is required",
          JSON.stringify(r),
        ]);
        return;
      }

      if (!/^\d{9,10}$/.test(recipientTel)) {
        errorLogs.push([
          importLogId,
          rowNo,
          "INVALID_TEL",
          "เบอร์โทรไม่ถูกต้อง",
          JSON.stringify(r),
        ]);
        return;
      }

      if (!address || !subdistrict || !district || !province || !zipcode) {
        errorLogs.push([
          importLogId,
          rowNo,
          "REQUIRED_ADDRESS",
          "address is required",
          JSON.stringify(r),
        ]);
        return;
      }

      if (!subdistrictId || !subdistrictMap[subdistrictId]) {
        errorLogs.push([
          importLogId,
          rowNo,
          "INVALID_SUBDISTRICT",
          "ไม่พบ subdistrict_id ใน master",
          JSON.stringify(r),
        ]);
        return;
      }

      const fromWarehouse = null;
      const toWarehouse = subdistrictMap[subdistrictId];

      const rowCustomerId = Number(roleId) === 2 ? tokenCustomerId : r.customer_id || null;

      if (Number(roleId) === 2 && !tokenCustomerId) {
        errorLogs.push([
          importLogId,
          rowNo,
          "CUSTOMER_ID_MISSING",
          "customer_id missing from token",
          JSON.stringify(r),
        ]);
        return;
      }

      values.push([
        r.no_bill || null,
        serialNo,
        r.receive_code || null,
        reference,
        sendDate,

        rowCustomerId,

        r.shipper_code || null,
        r.recipient_code || null,
        recipientName,
        recipientTel,

        address,
        subdistrict,
        district,
        province,
        zipcode,

        subdistrictId,
        fromWarehouse,
        toWarehouse,

        r.package_code || null,
        r.weight ? Number(r.weight) : null,
        r.width ? Number(r.width) : null,
        r.height ? Number(r.height) : null,
        r.length ? Number(r.length) : null,
        r.q ? Number(r.q) : null,

        importLogId,
        importStatusId,
        "STD",
        importLogId,
        userId,
      ]);
    });

    // ===== INSERT SHIPMENTS =====
    const chunkSize = 500;
    let totalInserted = 0;

    for (let i = 0; i < values.length; i += chunkSize) {
      const chunk = values.slice(i, i + chunkSize);

      const [result] = await connection.query(
        `
        INSERT INTO shipments (
          no_bill,
          serial_no,
          receive_code,
          reference,
          send_date,
          customer_id,
          shipper_code,
          recipient_code,
          recipient_name,
          recipient_tel,
          address,
          subdistrict,
          district,
          province,
          zipcode,
          subdistrict_id,
          from_warehouse,
          to_warehouse,
          package_code,
          weight,
          width,
          height,
          length,
          q,
          import_log_id,
          current_status_id,
          import_type,
          source_id,
          created_by
        ) VALUES ?
        `,
        [chunk],
      );

      totalInserted += result.affectedRows;
    }

    // ===== STATUS LOG =====
    if (totalInserted > 0) {
      const [shipmentRows] = await connection.query(
        `
        SELECT id, to_warehouse
        FROM shipments
        WHERE import_log_id = ?
        ORDER BY id
        `,
        [importLogId],
      );

      const statusLogs = shipmentRows.map((s) => [
        s.id,
        importStatusId,
        s.to_warehouse,
        userId,
      ]);

      if (statusLogs.length > 0) {
        await connection.query(
          `
          INSERT INTO logs_shipment_status (
            shipment_id,
            status_id,
            warehouse_id,
            user_id
          ) VALUES ?
          `,
          [statusLogs],
        );
      }
    }

    // ===== ERROR LOG =====
    if (errorLogs.length > 0) {
      await connection.query(
        `
        INSERT INTO logs_import_errors (
          import_log_id,
          row_no,
          error_code,
          error_message,
          raw_data
        ) VALUES ?
        `,
        [errorLogs],
      );
    }

    // ===== UPDATE IMPORT SUMMARY =====
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

    return res.json({
      success: true,
      message:
        errorLogs.length > 0
          ? `นำเข้าสำเร็จ ${totalInserted} รายการ, ไม่สำเร็จ ${errorLogs.length} รายการ`
          : "นำเข้าสำเร็จ",
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