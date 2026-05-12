import db from "../config/db.js";
// import { importSTDService } from "../services/import/importSTD.service.js";
import { formatDateOnly } from "../utils/formatDate.js";

export const importSTD = async (req, res) => {
  let connection;

  try {
    if (!req.user) return res.status(401).json({ message: "unauthorized" });

    const { rows, file_name } = req.body;
    const { id: userId, role_id: roleId, customer_id: customerId } = req.user;

    if (roleId === 2 && !customerId)
      return res.status(400).json({ message: "customer_id missing" });

    const customerIdValue = roleId === 2 ? customerId : null;
    if (!rows?.length) return res.status(400).json({ message: "no rows" });

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

    res.json({
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
    res.status(500).json({ message: err.message });
  }
};

// export const importSTD = async (req, res) => {
//   try {
//     const result = await importSTDService(req);

//     res.json(result);
//   } catch (err) {
//     res.status(500).json({
//       message: err.message,
//     });
//   }
// };

// ================= VGT =================
export const importVGT = async (req, res) => {
  let connection;

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { rows, file_name } = req.body;
    const userId = req.user.id;

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [logResult] = await connection.query(
      `
      INSERT INTO logs_imports (
        user_id, customer_id, import_type, input_type,
        file_name, total_rows, success_rows, failed_rows
      )
      VALUES (?, 30, 'VGT', 'EXCEL', ?, ?, 0, 0)
      `,
      [userId, file_name || null, rows.length],
    );

    const importLogId = logResult.insertId;

    const values = rows.map((r) => [
      r["เลขที่บาร์โค้ด"],
      r["เลขที่บิล"],
      r["รหัสอ้างอิง"],
      30,
      r["ผู้รับ"],
      null,
      null,
      r["ตำบล"],
      r["อำเภอ"],
      r["จังหวัด"],
      null,
      importLogId,
      "VGT",
      importLogId,
      userId,
      1,
    ]);

    await connection.query(
      `
      INSERT INTO shipments (...) VALUES ?
      `,
      [values],
    );

    await connection.commit();
    connection.release();

    res.json({ message: "นำเข้าสำเร็จ" });
  } catch (err) {
    if (connection) await connection.rollback();
    if (connection) connection.release();

    res.status(500).json({ message: err.message });
  }
};

// ================= ADV =================
export const importADV = async (req, res) => {
  let connection;

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { rows, file_name } = req.body;
    const userId = req.user.id;

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [logResult] = await connection.query(
      `
      INSERT INTO logs_imports (
        user_id, customer_id, import_type, input_type,
        file_name, total_rows, success_rows, failed_rows
      )
      VALUES (?, 22, 'ADV', 'EXCEL', ?, ?, 0, 0)
      `,
      [userId, file_name || null, rows.length],
    );

    const importLogId = logResult.insertId;

    const values = rows.map((r) => [
      r.box_sn,
      r.dpe_bill_no,
      r.dpe_bill_no,
      22,
      r.cusname,
      r.cusmobile,
      r.address,
      r.district_name,
      r.amphur_name,
      r.province_name,
      r.postcode,
      importLogId,
      "ADV",
      importLogId,
      userId,
      1,
    ]);

    await connection.query(
      `
      INSERT INTO shipments (...) VALUES ?
      `,
      [values],
    );

    await connection.commit();
    connection.release();

    res.json({ message: "นำเข้าสำเร็จ" });
  } catch (err) {
    if (connection) await connection.rollback();
    if (connection) connection.release();

    res.status(500).json({ message: err.message });
  }
};
