import db from "../config/db.js";

// ================= STD =================
export const importSTD = async (req, res) => {
  let connection;

  try {
    const { rows, file_name } = req.body;
    const userId = req.user?.id;

    if (!rows || !rows.length) {
      return res.status(400).json({ message: "no rows" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 🔥 create log
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
      VALUES (?, NULL, 'STD', 'EXCEL', ?, ?, 0, 0)
      `,
      [userId, file_name || null, rows.length]
    );

    const importLogId = logResult.insertId;

    const values = rows.map((r) => [
      r.SERIAL_NO,
      r.NO_BILL,
      r.REFERENCE,
      null,
      r.RECIPIENT_NAME,
      r.RECIPIENT_TEL,
      r.RECIPIENT_ADDRESS,
      r.RECIPIENT_SUBDISTRICT,
      r.RECIPIENT_DISTRICT,
      r.RECIPIENT_PROVINCE,
      r.RECIPIENT_ZIPCODE,
      importLogId,
      "STD",
      importLogId,
      userId,
      1,
    ]);

    const chunkSize = 500;
    let insertIdStart = null;
    let totalInserted = 0;

    for (let i = 0; i < values.length; i += chunkSize) {
      const chunk = values.slice(i, i + chunkSize);

      const [result] = await connection.query(
        `
        INSERT INTO shipments (
          serial_no, receive_code, reference,
          customer_id, recipient_name, recipient_tel,
          address, subdistrict, district, province, zipcode,
          import_log_id, import_type, source_id, created_by,
          current_status_id
        )
        VALUES ?
        `,
        [chunk]
      );

      if (insertIdStart === null) {
        insertIdStart = result.insertId;
      }

      totalInserted += result.affectedRows;
    }

    // 🔥 logs_shipment_status
    const statusLogs = [];
    for (let i = 0; i < totalInserted; i++) {
      statusLogs.push([
        insertIdStart + i,
        "IMPORT",
        null,
        userId,
      ]);
    }

    if (statusLogs.length) {
      await connection.query(
        `
        INSERT INTO logs_shipment_status (
          shipment_id, action, warehouse_id, user_id
        )
        VALUES ?
        `,
        [statusLogs]
      );
    }

    // 🔥 update logs_imports
    await connection.query(
      `
      UPDATE logs_imports
      SET success_rows = ?, failed_rows = 0
      WHERE id = ?
      `,
      [totalInserted, importLogId]
    );

    await connection.commit();
    connection.release();

    res.json({
      message: "import STD success",
      import_log_id: importLogId,
      total: totalInserted,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    if (connection) connection.release();

    res.status(500).json({ message: err.message });
  }
};

// ================= VGT =================
export const importVGT = async (req, res) => {
  let connection;

  try {
    const { rows, file_name } = req.body;
    const userId = req.user?.id;

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
      [userId, file_name || null, rows.length]
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
      [values]
    );

    await connection.commit();
    connection.release();

    res.json({ message: "import VGT success" });
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
    const { rows, file_name } = req.body;
    const userId = req.user?.id;

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
      [userId, file_name || null, rows.length]
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
      [values]
    );

    await connection.commit();
    connection.release();

    res.json({ message: "import ADV success" });
  } catch (err) {
    if (connection) await connection.rollback();
    if (connection) connection.release();

    res.status(500).json({ message: err.message });
  }
};