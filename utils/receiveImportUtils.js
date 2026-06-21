// server/utils/receiveImportUtils.js

import xlsx from "xlsx";
import { randomUUID } from "crypto";
import {
  cleanDbText,
  cleanCode,
  toNumberOrNull,
  toNumberOrZero,
  toYN,
  formatDateYYYYMMDD,
  padNumber,
  buildInsertSql,
} from "./cleanText.js";
import { cleanTel } from "./cleanTel.js";

export const createImportError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const readExcelRows = (buffer) => {
  const workbook = xlsx.read(buffer, {
    type: "buffer",
    cellDates: true,
  });

  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw createImportError("ไม่พบ Sheet ในไฟล์ Excel");
  }

  const sheet = workbook.Sheets[sheetName];

  return xlsx.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
  });
};

const cleanOptionalText = (value) => {
  const text = cleanDbText(value);
  return text || null;
};

const cleanOptionalCode = (value) => {
  const code = cleanCode(value);
  return code || null;
};

const normalizeYN = (value) => {
  const raw = String(value ?? "").trim();

  if (!raw) return null;

  return toYN(raw);
};

export const normalizeImportRow = (row, rowIndex) => {
  return {
    row_no: rowIndex + 2,

    no_bill: cleanOptionalCode(row.NO_BILL),

    reference_no: cleanOptionalCode(row.REFERENCE),
    send_date: cleanOptionalText(row.SEND_DATE),

    shipper_code: cleanOptionalCode(row.SHIPPER_CODE),

    recipient_name: cleanOptionalText(row.RECIPIENT_NAME),
    recipient_tel: cleanTel(row.RECIPIENT_TEL) || null,
    recipient_address: cleanOptionalText(row.RECIPIENT_ADDRESS),
    recipient_zipcode: cleanOptionalCode(row.RECIPIENT_ZIPCODE),

    is_document_return: normalizeYN(row.IS_DOCUMENT_RETURN),
    document_return_code: cleanOptionalCode(row.DOCUMENT_RETURN_CODE),

    payment_type_id: toNumberOrNull(row.PAYMENT_TYPE_ID),

    is_cod: normalizeYN(row.IS_COD),
    cod: toNumberOrZero(row.COD),

    note: cleanOptionalText(row.NOTE),

    subdistrict_id: toNumberOrNull(row.subdistrict_id ?? row.SUBDISTRICT_ID),

    // detail / item fields
    package_code: cleanOptionalCode(row.PACKAGE_CODE),

    weight: toNumberOrNull(row.WEIGHT),
    width: toNumberOrNull(row.WIDTH),
    height: toNumberOrNull(row.HEIGHT),
    length: toNumberOrNull(row.LENGTH),
    q: toNumberOrNull(row.Q),

    is_serial_no: normalizeYN(row.IS_SERIAL_NO),
    serial_no: cleanOptionalCode(row.SERIAL_NO),
  };
};

export const isEmptyImportRow = (row) => {
  return [
    row.no_bill,
    row.reference_no,
    row.send_date,
    row.shipper_code,
    row.recipient_name,
    row.recipient_tel,
    row.recipient_address,
    row.recipient_zipcode,
    row.subdistrict_id,

    row.package_code,
    row.weight,
    row.width,
    row.height,
    row.length,
    row.q,
    row.serial_no,
  ].every((value) => {
    return value === null || value === undefined || String(value).trim() === "";
  });
};

export const parseExcelDate = (value) => {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  const text = String(value).trim();

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, dd, mm, yyyy] = slashMatch;

    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(
      2,
      "0",
    )}`;
  }

  const dashMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dashMatch) {
    const [, yyyy, mm, dd] = dashMatch;

    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(
      2,
      "0",
    )}`;
  }

  const parsed = new Date(text);

  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  return null;
};

export const groupRowsByNoBill = (rows) => {
  const map = new Map();

  for (const row of rows) {
    if (!row.no_bill) {
      throw createImportError(`แถว ${row.row_no}: ไม่พบ NO_BILL`);
    }

    if (!map.has(row.no_bill)) {
      map.set(row.no_bill, []);
    }

    map.get(row.no_bill).push(row);
  }

  return map;
};

export const validateImportHeadRow = (row) => {
  if (!row.no_bill) return `แถว ${row.row_no}: ไม่พบ NO_BILL`;

  if (!row.send_date) return `แถว ${row.row_no}: ไม่พบ SEND_DATE`;

  if (!parseExcelDate(row.send_date)) {
    return `แถว ${row.row_no}: SEND_DATE ไม่ถูกต้อง`;
  }

  if (!row.shipper_code) return `แถว ${row.row_no}: ไม่พบ SHIPPER_CODE`;

  if (!row.recipient_name) {
    return `แถว ${row.row_no}: ไม่พบ RECIPIENT_NAME`;
  }

  if (!row.recipient_address) {
    return `แถว ${row.row_no}: ไม่พบ RECIPIENT_ADDRESS`;
  }

  if (!row.subdistrict_id) {
    return `แถว ${row.row_no}: ไม่พบ subdistrict_id`;
  }

  if (row.is_serial_no === "Y" && !row.serial_no) {
  return `แถว ${row.row_no}: IS_SERIAL_NO = Y แต่ไม่พบ SERIAL_NO`;
}

  return null;
};

export const validateSameBillHeader = (rows) => {
  const first = rows[0];

  const fields = [
    "reference_no",
    "send_date",
    "shipper_code",
    "recipient_name",
    "recipient_tel",
    "recipient_address",
    "recipient_zipcode",
    "subdistrict_id",
    "is_document_return",
    "document_return_code",
    "payment_type_id",
    "is_cod",
    "cod",
  ];

  for (const row of rows) {
    for (const field of fields) {
      if (String(row[field] ?? "") !== String(first[field] ?? "")) {
        throw createImportError(
          `NO_BILL ${first.no_bill}: ข้อมูลหัวบิล field ${field} ไม่ตรงกันที่แถว ${row.row_no}`,
        );
      }
    }
  }
};

export const getMasterAddressBySubdistrictId = async (
  conn,
  subdistrictId,
  cache,
) => {
  const cleanSubdistrictId = toNumberOrNull(subdistrictId);

  if (!cleanSubdistrictId) {
    throw createImportError("ไม่พบ subdistrict_id");
  }

  if (cache.has(cleanSubdistrictId)) {
    return cache.get(cleanSubdistrictId);
  }

  const [rows] = await conn.query(
    `
      SELECT
        subdistrict_id,
        district_id,
        province_id,
        warehouse_id
      FROM mm_master_addresses
      WHERE subdistrict_id = ?
      LIMIT 1
    `,
    [cleanSubdistrictId],
  );

  if (rows.length === 0) {
    throw createImportError("ไม่พบข้อมูลตำบลนี้ในระบบ");
  }

  if (!rows[0].warehouse_id) {
    throw createImportError("ไม่พบ warehouse_id ของตำบลนี้");
  }

  const address = {
    subdistrict_id: rows[0].subdistrict_id,
    district_id: rows[0].district_id,
    province_id: rows[0].province_id,
    warehouse_id: rows[0].warehouse_id,
  };

  cache.set(cleanSubdistrictId, address);

  return address;
};

export const getShipperByCustomerAndCode = async ({
  conn,
  customerId,
  shipperCode,
  cache,
}) => {
  const cleanCustomerId = toNumberOrNull(customerId);
  const cleanShipperCode = cleanCode(shipperCode);

  if (!cleanCustomerId) {
    throw createImportError("กรุณาเลือก Customer ก่อนนำเข้า");
  }

  if (!cleanShipperCode) {
    throw createImportError("ไม่พบ SHIPPER_CODE");
  }

  const cacheKey = `${cleanCustomerId}:${cleanShipperCode}`;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const [rows] = await conn.query(
    `
      SELECT
        shipper_id,
        subdistrict_id
      FROM mm_shippers
      WHERE customer_id = ?
        AND shipper_code = ?
        AND (is_deleted IS NULL OR is_deleted = 'N')
      LIMIT 1
    `,
    [cleanCustomerId, cleanShipperCode],
  );

  if (rows.length === 0) {
    throw createImportError("เจ้าของงานนี้ไม่มี shipper_code นี้");
  }

  if (!rows[0].subdistrict_id) {
    throw createImportError("shipper นี้ไม่มี subdistrict_id");
  }

  const shipper = {
    shipper_id: rows[0].shipper_id,
    subdistrict_id: rows[0].subdistrict_id,
  };

  cache.set(cacheKey, shipper);

  return shipper;
};

const parseRunningCode = (code) => {
  const text = String(code || "");
  const lastDashIndex = text.lastIndexOf("-");

  if (lastDashIndex === -1) {
    throw createImportError(`receive_code ไม่ถูกต้อง: ${code}`);
  }

  const prefix = text.slice(0, lastDashIndex + 1);
  const runningText = text.slice(lastDashIndex + 1);
  const running = Number(runningText);

  if (!Number.isFinite(running)) {
    throw createImportError(`running receive_code ไม่ถูกต้อง: ${code}`);
  }

  return {
    prefix,
    running,
    runningLength: runningText.length,
  };
};

export const buildNextImportReceiveCode = ({
  prefix,
  running,
  runningLength,
}) => {
  return `${prefix}${String(running).padStart(runningLength, "0")}`;
};

export const generateFirstImportReceiveCode = async (conn, customerId) => {
  const cleanCustomerId = toNumberOrNull(customerId);

  if (!cleanCustomerId) {
    throw createImportError("ไม่พบ customer_id");
  }

  const [customerRows] = await conn.query(
    `
      SELECT code
      FROM mm_customers
      WHERE id = ?
      LIMIT 1
    `,
    [cleanCustomerId],
  );

  if (customerRows.length === 0) {
    throw createImportError("ไม่พบข้อมูลเจ้าของงาน");
  }

  const customerCode = cleanCode(customerRows[0].code);

  if (!customerCode) {
    throw createImportError("เจ้าของงานนี้ไม่มี code");
  }

  const dateCode = formatDateYYYYMMDD();
  const prefix = `DO-${customerCode}-${dateCode}-`;

  const [runningRows] = await conn.query(
    `
      SELECT receive_code
      FROM tm_receive_import_head
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
    const { running } = parseRunningCode(latestCode);

    nextRunning = running + 1;
  }

  return `${prefix}${padNumber(nextRunning, 4)}`;
};

export const buildReceiveCodeMapByNoBill = async ({
  conn,
  customerId,
  billGroups,
}) => {
  const firstCode = await generateFirstImportReceiveCode(conn, customerId);
  const codeParts = parseRunningCode(firstCode);

  const map = new Map();

  billGroups.forEach(([noBill], index) => {
    const receiveCode = buildNextImportReceiveCode({
      prefix: codeParts.prefix,
      running: codeParts.running + index,
      runningLength: codeParts.runningLength,
    });

    map.set(noBill, receiveCode);
  });

  return map;
};

export const getRequestUserId = (req) => {
  return toNumberOrNull(
    req.user?.user_id ??
      req.user?.id ??
      req.user?.people_id ??
      req.user?.employee_id,
  );
};

export const createImportLog = async ({ conn, customerId, createdBy }) => {
  const now = new Date();

  const data = {
    created_date: now,
    status: "RUNNING",
    is_deleted: "N",
    created_by: createdBy,
    customer_id: customerId,
    updated_date: now,
    updated_by: createdBy,
    queue_processed: 0,
    queue_stop_requested: "N",
    queue_started_at: now,
  };

  const { sql, values } = buildInsertSql("tm_receive_imports", data);

  const [result] = await conn.query(sql, values);

  return result.insertId;
};

export const updateImportLogRunning = async ({
  conn,
  importId,
  queueTotal,
  updatedBy,
}) => {
  await conn.query(
    `
      UPDATE tm_receive_imports
      SET
        queue_total = ?,
        updated_date = ?,
        updated_by = ?
      WHERE id = ?
    `,
    [queueTotal, new Date(), updatedBy, importId],
  );
};

export const updateImportLogSuccess = async ({
  conn,
  importId,
  queueTotal,
  queueProcessed,
  updatedBy,
}) => {
  await conn.query(
    `
      UPDATE tm_receive_imports
      SET
        status = 'SUCCESS',
        updated_date = ?,
        updated_by = ?,
        queue_total = ?,
        queue_processed = ?,
        queue_last_error = NULL,
        queue_finished_at = ?
      WHERE id = ?
    `,
    [
      new Date(),
      updatedBy,
      queueTotal,
      queueProcessed,
      new Date(),
      importId,
    ],
  );
};

export const updateImportLogFailed = async ({
  conn,
  importId,
  queueTotal,
  queueProcessed,
  errorMessage,
  updatedBy,
}) => {
  if (!importId) return;

  await conn.query(
    `
      UPDATE tm_receive_imports
      SET
        status = 'FAILED',
        updated_date = ?,
        updated_by = ?,
        queue_total = ?,
        queue_processed = ?,
        queue_last_error = ?,
        queue_finished_at = ?
      WHERE id = ?
    `,
    [
      new Date(),
      updatedBy,
      queueTotal,
      queueProcessed,
      errorMessage,
      new Date(),
      importId,
    ],
  );
};

export const buildImportHeadData = ({
  row,
  customerId,
  shipper,
  receiveCode,
  recipientAddress,
  shipperAddress,
  importDate,
  importId,
}) => {
  const deliveryDate = parseExcelDate(row.send_date);

  if (!deliveryDate) {
    throw createImportError(`แถว ${row.row_no}: SEND_DATE ไม่ถูกต้อง`);
  }

  return {
    receive_date: importDate,
    receive_code: receiveCode,

    customer_id: customerId,
    shipper_id: shipper.shipper_id,

    recipient_name: row.recipient_name,
    address: row.recipient_address,

    province_id: recipientAddress.province_id,
    district_id: recipientAddress.district_id,
    subdistrict_id: recipientAddress.subdistrict_id,

    zip_code: row.recipient_zipcode,
    tel: row.recipient_tel,

    delivery_date: deliveryDate,

    is_cod: row.is_cod,
    cod: row.cod,

    is_document_return: row.is_document_return,
    document_return: row.document_return_code,

    payment_type_id: row.payment_type_id,

    reference_no: row.reference_no,
    remark: row.note,

    from_warehouse_id: shipperAddress.warehouse_id,
    to_warehouse_id: recipientAddress.warehouse_id,

    import_id: importId,
  };
};

export const buildImportDetailData = ({ receiveId, row }) => {
  return {
    receive_id: receiveId,

    weight: row.weight,
    width: row.width,
    height: row.height,
    length: row.length,
    q: row.q,

    is_document_return: row.is_document_return,
  };
};

export const buildImportDetailItemData = ({
  receiveDetailId,
  productSerial,
}) => {
  if (!productSerial) return null;

  return {
    receive_detail_id: receiveDetailId,
    serial_id: productSerial.serial_id,
    serial_no: productSerial.serial_no,
    is_deleted: "N",
  };
};

export const createActiveSerialOrThrow = async (conn, serialNo) => {
  const cleanSerialNo = cleanCode(serialNo);

  if (!cleanSerialNo) {
    throw createImportError("ไม่พบ SERIAL_NO");
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