// server/utils/receiveUtils.js

import { randomUUID } from "crypto";

import { cleanCode, cleanDbText, formatDateYYYYMMDD, padNumber, toNumberOrNull, toNumberOrZero } from "./cleanText.js";

export const generateReceiveCode = async (conn, customerId) => {
  const [customerRows] = await conn.query(
    `
      SELECT code
      FROM mm_customers
      WHERE id = ?
      LIMIT 1
    `,
    [customerId],
  );

  if (customerRows.length === 0) {
    throw new Error("ไม่พบข้อมูลเจ้าของงาน");
  }

  const customerCode = cleanCode(customerRows[0].code);

  if (!customerCode) {
    throw new Error("เจ้าของงานนี้ไม่มี code");
  }

  const dateCode = formatDateYYYYMMDD();
  const prefix = `DO-${customerCode}-${dateCode}-`;

  const [runningRows] = await conn.query(
    `
      SELECT receive_code
      FROM tm_receives
      WHERE receive_code LIKE ?
      ORDER BY receive_code DESC
      LIMIT 1
      FOR UPDATE
    `,
    [`${prefix}%`],
  );

  let nextRunning = 1;

  if (runningRows.length > 0) {
    const latestCode = String(runningRows[0].receive_code || "");
    const latestRunningText = latestCode.replace(prefix, "");
    const latestRunning = Number(latestRunningText);

    if (Number.isFinite(latestRunning)) {
      nextRunning = latestRunning + 1;
    }
  }

  // receive_code running 4 หลัก เช่น DO-A000021-20260615-0001
  return `${prefix}${padNumber(nextRunning, 4)}`;
};

export const getFromWarehouseIdByShipper = async (conn, shipperId) => {
  const [rows] = await conn.query(
    `
      SELECT
        s.shipper_id,
        s.subdistrict_id,
        ma.warehouse_id
      FROM mm_shippers s
      LEFT JOIN mm_master_addresses ma
        ON ma.subdistrict_id = s.subdistrict_id
      WHERE s.shipper_id = ?
      LIMIT 1
    `,
    [shipperId],
  );

  if (rows.length === 0) {
    throw new Error("ไม่พบข้อมูลผู้ส่ง");
  }

  if (!rows[0].subdistrict_id) {
    throw new Error("ผู้ส่งนี้ไม่มี subdistrict_id");
  }

  if (!rows[0].warehouse_id) {
    throw new Error("ไม่พบ warehouse_id จากตำบลของผู้ส่ง");
  }

  return rows[0].warehouse_id;
};

export const getToWarehouseIdByRecipientDetail = async (conn, recipientDetailId) => {
  const [rows] = await conn.query(
    `
      SELECT
        rd.recipient_detail_id,
        rd.subdistrict_id,
        ma.warehouse_id
      FROM mm_recipient_details rd
      LEFT JOIN mm_master_addresses ma
        ON ma.subdistrict_id = rd.subdistrict_id
      WHERE rd.recipient_detail_id = ?
      LIMIT 1
    `,
    [recipientDetailId],
  );

  if (rows.length === 0) {
    throw new Error("ไม่พบข้อมูลที่อยู่ผู้รับ");
  }

  if (!rows[0].subdistrict_id) {
    throw new Error("ที่อยู่ผู้รับนี้ไม่มี subdistrict_id");
  }

  if (!rows[0].warehouse_id) {
    throw new Error("ไม่พบ warehouse_id จากตำบลของผู้รับ");
  }

  return rows[0].warehouse_id;
};

/**
 * รับ packageRows จาก frontend แล้วกรองเฉพาะรายการที่มี package + detail จริง
 */
export const normalizePackageRows = (packageRows) => {
  if (!Array.isArray(packageRows)) return [];

  return packageRows.filter((row) => {
    return row && row.package_id && row.package_detail_id;
  });
};

/**
 * qty ต้องเป็นเลขเต็มบวกเท่านั้น
 */
export const getSafeQty = (value) => {
  const qty = Number(value);

  if (!Number.isFinite(qty) || qty <= 0) return 1;

  return Math.floor(qty);
};

/**
 * สร้าง SN Auto ตอนรายการไม่มี barcode
 *
 * รูปแบบ:
 * DO-A000021-20260615-0001-TMGXXXXXXXX
 *
 * XXXXXXXX = สุ่ม 8 ตัว พิมพ์ใหญ่
 */
export const makeAutoSerial = (receiveCode) => {
  const randomText = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();

  return `${receiveCode}-TMG${randomText}`;
};

/**
 * map packageRows 1 row -> tm_receive_details 1 row
 *
 * tm_receive_details = รายละเอียดสินค้า/กล่อง/ขนาดในบิล
 */
export const buildReceiveDetailData = ({ receiveId, row }) => {
  const qty = getSafeQty(row.qty);

  return {
    receive_id: receiveId,

    package_id: toNumberOrNull(row.package_id),
    package_detail_id: toNumberOrNull(row.package_detail_id),

    package_name: cleanDbText(row.package_name),

    // frontend ตอนนี้ยังไม่มี unit_name ตรง ๆ
    unit_name: null,

    qty,

    // ราคา/หน่วย
    cost: toNumberOrZero(row.unit_price ?? row.cost),

    weight: toNumberOrNull(row.weight),

    // DB เก่ามี แต่ frontend ยังไม่ได้ใช้จริง
    cost_difference: 0,
    remark: null,

    width: toNumberOrNull(row.width),
    height: toNumberOrNull(row.height),
    length: toNumberOrNull(row.length),

    cost_island: 0,
    cost_other: 0,

    q: toNumberOrNull(row.q),

    // เป็น enum อย่าเพิ่งเอา package_detail_type ไปยัด เดี๋ยว enum ไม่ตรงแล้วพัง
    size_type: null,

    // frontend ยังไม่ได้ส่ง vol
    vol: null,

    updated_at: new Date(),
  };
};

/**
 * map packageRows 1 row -> tm_receive_detail_items หลาย row ได้
 *
 * tm_receive_detail_items = SN / Barcode รายชิ้น
 *
 * หมายเหตุ:
 * serial_id จะถูกเติมทีหลังใน controller
 * โดยใช้ getOrCreateProductSerial(conn, serial_no)
 */
export const buildReceiveDetailItems = ({ receiveCode, receiveDetailId, row }) => {
  const qty = getSafeQty(row.qty);
  const barcode = cleanCode(row.barcode);

  // กรณีสแกน barcode มา
  // frontend set qty = 1 อยู่แล้ว
  if (barcode) {
    return [
      {
        receive_detail_id: receiveDetailId,

        // ยังไม่ใส่ตรงนี้ เดี๋ยว controller ไปหา/สร้างจาก tm_product_actived ก่อน
        serial_id: null,

        serial_no: barcode,
        is_deleted: "N",
        deleted_by: null,
        deleted_time: null,
      },
    ];
  }

  // กรณีไม่มี barcode ให้สร้าง SN Auto ตาม qty
  return Array.from({ length: qty }, () => {
    const serialNo = makeAutoSerial(receiveCode);

    return {
      receive_detail_id: receiveDetailId,

      // ยังไม่ใส่ตรงนี้ เดี๋ยว controller ไปหา/สร้างจาก tm_product_actived ก่อน
      serial_id: null,

      serial_no: serialNo,
      is_deleted: "N",
      deleted_by: null,
      deleted_time: null,
    };
  });
};

export const createActiveSerialOrThrow = async (conn, serialNo) => {
  const cleanSerialNo = cleanCode(serialNo);

  if (!cleanSerialNo) {
    throw createImportError("serial_no required");
  }

  const [existingRows] = await conn.query(
    `
      SELECT serial_id, serial_no
      FROM tm_product_actived
      WHERE serial_no = ?
      LIMIT 1
      FOR UPDATE
    `,
    [cleanSerialNo],
  );

  if (existingRows.length > 0) {
    throw createImportError(`SERIAL_NO ${cleanSerialNo} ยังมีงานค้างอยู่`);
  }

  const serialId = randomUUID();

  try {
    await conn.query(
      `
        INSERT INTO tm_product_actived
        (serial_id, serial_no)
        VALUES (?, ?)
      `,
      [serialId, cleanSerialNo],
    );

    return {
      serial_id: serialId,
      serial_no: cleanSerialNo,
    };
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      throw createImportError(`SERIAL_NO ${cleanSerialNo} ยังมีงานค้างอยู่`);
    }

    throw error;
  }
};
