import db from "../config/db.js";
import { getPaginationParams } from "../utils/pagination.js";

const excelDateToMySQL = (input) => {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "string" && input.includes("-")) return input;
  const serial =
    typeof input === "number" ? input : parseFloat(String(input).trim());
  if (!serial || isNaN(serial)) return null;
  const jsDate = new Date((serial - 25569) * 86400 * 1000);
  const iso = jsDate.toISOString().split("T")[0];
  return iso;
};

export const getBillsReport = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();

    const { SERIAL_NO, REFERENCE, warehouse_id, created_at } = req.query;

    const { page, pageSize, skip } = getPaginationParams(req, 100);

    let baseSql = `
      FROM bills_data bd
      LEFT JOIN bills b 
        ON b.REFERENCE = bd.REFERENCE
      LEFT JOIN bill_images bi 
        ON bi.bill_id = b.id
      WHERE 1=1
    `;

    const params = [];

    if (SERIAL_NO?.trim()) {
      baseSql += ` AND bd.SERIAL_NO LIKE ?`;
      params.push(`%${SERIAL_NO.trim()}%`);
    }

    if (REFERENCE?.trim()) {
      baseSql += ` AND bd.REFERENCE LIKE ?`;
      params.push(`%${REFERENCE.trim()}%`);
    }

    if (warehouse_id) {
      baseSql += ` AND bd.warehouse_id = ?`;
      params.push(Number(warehouse_id));
    }

    if (created_at?.trim()) {
      baseSql += `
    AND bd.created_at >= ?
    AND bd.created_at < DATE_ADD(?, INTERVAL 1 DAY)
  `;
      params.push(created_at.trim(), created_at.trim());
    }

    const countSql = `
      SELECT COUNT(*) AS total
      FROM (
        SELECT bd.id AS bd_id, b.id AS bill_id
        ${baseSql}
        GROUP BY bd.id, b.id
      ) x
    `;

    const [[countRow]] = await connection.query(countSql, params);
    const total = countRow?.total || 0;

    const dataSql = `
      SELECT
        bd.*,
        b.id AS bill_id,
        b.user_id AS bill_user_id,
        b.name AS bill_name,
        b.surname AS bill_surname,
        b.license_plate AS bill_license_plate,
        b.dc_id AS bill_dc_id,
        b.sign AS bill_sign,
        b.remark AS bill_remark,
        DATE_FORMAT(bd.created_at, '%Y-%m-%dT%H:%i:%s') AS created_at,
        GROUP_CONCAT(bi.image_url ORDER BY bi.id) AS bill_image_urls
      ${baseSql}
      GROUP BY bd.id, b.id
      ORDER BY b.created_at DESC, bd.id DESC
      LIMIT ? OFFSET ?
    `;

    const dataParams = [...params, pageSize, skip];
    const [rows] = await connection.query(dataSql, dataParams);

    const data = rows.map((row) => ({
      ...row,
      bill_image_urls: row.bill_image_urls
        ? row.bill_image_urls.split(",")
        : [],
    }));

    res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error("Error getBillsReport:", err);
    res.status(500).json({
      success: false,
      message: "ไม่สามารถดึงข้อมูล report bills ได้",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getBillsDataBySerial = async (req, res) => {
  let connection;
  try {
    const serial = (req.query.serial || "").toString().trim();

    if (!serial) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุ SERIAL_NO",
      });
    }

    connection = await db.getConnection();

    const [[row]] = await connection.query(
      `
      SELECT REFERENCE
      FROM bills_data
      WHERE SERIAL_NO = ?
      LIMIT 1
      `,
      [serial],
    );

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบ SERIAL_NO นี้",
      });
    }

    const reference = row.REFERENCE;

    const [rows] = await connection.query(
      `
      SELECT id, SERIAL_NO, REFERENCE, warehouse_accept, dc_accept
      FROM bills_data
      WHERE REFERENCE = ?
      ORDER BY id ASC
      `,
      [reference],
    );

    return res.json({
      success: true,
      reference,
      rows,
      count: rows.length,
    });
  } catch (err) {
    console.error("getBillsDataBySerial ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "backend error",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const importBillsData = async (req, res) => {
  let connection;

  try {
    const { rows, user_id, type } = req.body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        message: "ไม่มีข้อมูลสำหรับนำเข้า",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [warehouseRows] = await connection.query(
      "SELECT warehouse_id, warehouse_name, zip_code FROM master_warehouses",
    );

    const warehouseMap = {};
    warehouseRows.forEach((w) => {
      warehouseMap[w.zip_code] = {
        warehouse_id: w.warehouse_id,
        warehouse_name: w.warehouse_name,
      };
    });

    const insertValues = rows.map((r) => {
      const w = warehouseMap[r.RECIPIENT_ZIPCODE] || {};

      return [
        r.NO_BILL || null,
        r.REFERENCE || null,
        excelDateToMySQL(r.SEND_DATE) || null,
        r.SHIPPER_CODE || null,
        r.RECIPIENT_CODE || null,
        r.RECIPIENT_NAME || null,
        r.RECIPIENT_TEL || null,
        r.RECIPIENT_ADDRESS || null,
        r.RECIPIENT_SUBDISTRICT || null,
        r.RECIPIENT_DISTRICT || null,
        r.RECIPIENT_PROVINCE || null,
        r.RECIPIENT_ZIPCODE || null,
        r.SERIAL_NO || null,
        r.PRICE || null,
        user_id || null,
        w.warehouse_name || null,
        w.warehouse_id || null,
        type || "IMPORT",
      ];
    });

    await connection.query(
      `
      INSERT INTO bills_data 
      (
        NO_BILL, REFERENCE, SEND_DATE, CUSTOMER_NAME, RECIPIENT_CODE,
        RECIPIENT_NAME, RECIPIENT_TEL, RECIPIENT_ADDRESS,
        RECIPIENT_SUBDISTRICT, RECIPIENT_DISTRICT, RECIPIENT_PROVINCE,
        RECIPIENT_ZIPCODE, SERIAL_NO, PRICE, user_id,
        warehouse_name, warehouse_id,
        type
      )
      VALUES ?
      `,
      [insertValues],
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: `นำเข้าข้อมูลสำเร็จ จำนวน ${rows.length} แถว`,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error while importing bills_data:", err);

    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดระหว่างนำเข้าข้อมูล",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const importBillsADV = async (req, res) => {
  let connection;

  try {
    const { rows, user_id, type } = req.body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        message: "ไม่มีข้อมูลสำหรับนำเข้า",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [warehouseRows] = await connection.query(
      "SELECT warehouse_id, warehouse_name, zip_code FROM master_warehouses",
    );

    const warehouseMap = {};
    warehouseRows.forEach((w) => {
      warehouseMap[w.zip_code] = {
        warehouse_id: w.warehouse_id,
        warehouse_name: w.warehouse_name,
      };
    });

    const insertValues = rows.map((r) => {
      const w = warehouseMap[r.RECIPIENT_ZIPCODE] || {};

      return [
        r.NO_BILL || null,
        r.REFERENCE || null,
        excelDateToMySQL(r.SEND_DATE) || null,
        r.CUSTOMER_NAME || null,
        r.RECIPIENT_CODE || null,
        r.RECIPIENT_NAME || null,
        r.RECIPIENT_TEL || null,
        r.RECIPIENT_ADDRESS || null,
        r.RECIPIENT_SUBDISTRICT || null,
        r.RECIPIENT_DISTRICT || null,
        r.RECIPIENT_PROVINCE || null,
        r.RECIPIENT_ZIPCODE || null,
        r.SERIAL_NO || null,
        r.PRICE || null,
        user_id || null,
        w.warehouse_name || null,
        w.warehouse_id || null,
        type || "IMPORT",
      ];
    });

    await connection.query(
      `
      INSERT INTO bills_data 
      (
        NO_BILL, REFERENCE, SEND_DATE, CUSTOMER_NAME, RECIPIENT_CODE,
        RECIPIENT_NAME, RECIPIENT_TEL, RECIPIENT_ADDRESS,
        RECIPIENT_SUBDISTRICT, RECIPIENT_DISTRICT, RECIPIENT_PROVINCE,
        RECIPIENT_ZIPCODE, SERIAL_NO, PRICE, user_id,
        warehouse_name, warehouse_id,
        type
      )
      VALUES ?
      `,
      [insertValues],
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: `นำเข้าข้อมูลสำเร็จ จำนวน ${rows.length} แถว`,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error while importing bills_data:", err);

    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดระหว่างนำเข้าข้อมูล",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const importBillsVGT = async (req, res) => {
  let connection;

  try {
    const { rows, user_id, type } = req.body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ไม่มีข้อมูลสำหรับนำเข้า",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [warehouseRows] = await connection.query(
      "SELECT warehouse_id, warehouse_name, dc_code FROM mm_warehouses",
    );

    const warehouseMapByCode = {};
    warehouseRows.forEach((w) => {
      if (!w.dc_code) return;
      warehouseMapByCode[String(w.dc_code).trim()] = {
        warehouse_id: w.warehouse_id,
        warehouse_name: w.warehouse_name,
      };
    });

    const parseDcCode = (toDcRaw) => {
      if (!toDcRaw) return "";
      const s = String(toDcRaw).trim();

      const firstToken = s.split(/\s+/)[0];
      return firstToken;
    };

    const insertValues = rows.map((r) => {
      const dcCode = parseDcCode(r.TO_DC);
      const w = warehouseMapByCode[dcCode] || {};

      return [
        r.NO_BILL || null,
        r.REFERENCE || null,
        excelDateToMySQL(r.SEND_DATE) || null,
        r.CUSTOMER_NAME || null,
        r.RECIPIENT_CODE || null,
        r.RECIPIENT_NAME || null,
        r.RECIPIENT_TEL || null,
        r.RECIPIENT_ADDRESS || null,
        r.RECIPIENT_SUBDISTRICT || null,
        r.RECIPIENT_DISTRICT || null,
        r.RECIPIENT_PROVINCE || null,
        r.RECIPIENT_ZIPCODE || null,
        r.SERIAL_NO || null,
        r.PRICE || null,
        user_id || null,
        w.warehouse_name || null,
        w.warehouse_id || null,
        type || "IMPORT",
      ];
    });

    await connection.query(
      `
      INSERT INTO bills_data 
      (
        NO_BILL, REFERENCE, SEND_DATE, CUSTOMER_NAME, RECIPIENT_CODE,
        RECIPIENT_NAME, RECIPIENT_TEL, RECIPIENT_ADDRESS,
        RECIPIENT_SUBDISTRICT, RECIPIENT_DISTRICT, RECIPIENT_PROVINCE,
        RECIPIENT_ZIPCODE, SERIAL_NO, PRICE, user_id,
        warehouse_name, warehouse_id,
        type
      )
      VALUES ?
      `,
      [insertValues],
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: `นำเข้าข้อมูล VGT สำเร็จ จำนวน ${rows.length} แถว`,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error while importing bills_data VGT:", err);

    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดระหว่างนำเข้าข้อมูล VGT",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getBillsWarehouse = async (req, res) => {
  let connection;

  try {
    const { warehouse_accept = "N" } = req.query;

    connection = await db.getConnection();

    const [rows] = await connection.query(
      `
      SELECT
        id,
        NO_BILL,
        SERIAL_NO,
        CUSTOMER_NAME,
        warehouse_name
      FROM bills_data
      WHERE warehouse_accept = ?
      ORDER BY id ASC
      `,
      [warehouse_accept],
    );

    res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (err) {
    console.error("Error getBillsWarehouse:", err);
    res.status(500).json({
      success: false,
      message: "ไม่สามารถดึงข้อมูล bills_data สำหรับ Warehouse ได้",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const updateBillsWarehouseAccept = async (req, res) => {
  let connection;

  try {
    const { serials, accept_flag = "Y" } = req.body;

    if (!serials || !Array.isArray(serials) || serials.length === 0) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุ serials เป็น array",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    await connection.query(
      `
      UPDATE bills_data
      SET warehouse_accept = ?
      WHERE SERIAL_NO IN (?)
      `,
      [accept_flag, serials],
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: `อัปเดตสถานะ warehouse_accept = '${accept_flag}' ให้ ${serials.length} รายการเรียบร้อย`,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error updateBillsWarehouseAccept:", err);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการอัปเดต warehouse_accept",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getBillsDC = async (req, res) => {
  let connection;

  try {
    const { warehouse_accept = "Y", dc_accept = "N" } = req.query;

    const currentUserId = req.user?.user_id || req.query.user_id;

    if (!currentUserId) {
      return res.status(400).json({
        success: false,
        message: "ต้องระบุ user_id หรือ login ก่อน",
      });
    }

    connection = await db.getConnection();

    const [rows] = await connection.query(
      `
      SELECT 
        b.id,
        b.NO_BILL,
        b.SERIAL_NO,
        b.CUSTOMER_NAME,
        b.warehouse_name
      FROM bills_data b
      JOIN mm_user_dc d
        ON d.warehouse_id = b.warehouse_id   
      JOIN um_users u
        ON u.dc_id = d.id                    
      WHERE u.user_id = ?   
        AND u.role_id = 4
        AND b.dc_accept = ?
        AND b.warehouse_accept = ?
      ORDER BY b.id ASC
      `,
      [currentUserId, dc_accept, warehouse_accept],
    );

    res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (err) {
    console.error("Error getBillsDC:", err);
    res.status(500).json({
      success: false,
      message: "ไม่สามารถดึงข้อมูล bills_data สำหรับ DC ได้",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const updateBillsDCAccept = async (req, res) => {
  let connection;

  try {
    const { serials, accept_flag = "Y" } = req.body;

    if (!serials || !Array.isArray(serials) || serials.length === 0) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุ serials เป็น array",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    await connection.query(
      `
      UPDATE bills_data
      SET dc_accept = ?
      WHERE SERIAL_NO IN (?)
      `,
      [accept_flag, serials],
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: `อัปเดตสถานะ dc_accept = '${accept_flag}' ให้ ${serials.length} รายการเรียบร้อย`,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error updateBillsDCAccept:", err);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการอัปเดต dc_accept",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};
