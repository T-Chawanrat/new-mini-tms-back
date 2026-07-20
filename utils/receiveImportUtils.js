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

const isYN = (value, expected) => {
  return String(value ?? "").trim().toUpperCase() === expected;
};

const isValueInRange = (value, min, max) => {
  const cleanValue = toNumberOrNull(value);
  const cleanMin = toNumberOrNull(min);
  const cleanMax = toNumberOrNull(max);

  if (cleanValue === null || cleanMin === null || cleanMax === null) {
    return false;
  }

  return cleanValue >= cleanMin && cleanValue <= cleanMax;
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

  if (!row.package_code) {
    return `แถว ${row.row_no}: ไม่พบ PACKAGE_CODE`;
  }

  if (row.q === null && row.weight === null) {
    return `แถว ${row.row_no}: ต้องมี Q หรือ WEIGHT อย่างน้อย 1 ค่า`;
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

const findMatchedPackageBusiness = ({ businessRows, q, weight }) => {
  const activeRows = businessRows.filter((row) => {
    return row && isYN(row.business_is_deleted, "N");
  });

  if (activeRows.length === 0) {
    return null;
  }

  const weightFixRow = activeRows.find((row) => isYN(row.is_weight_fix, "Y"));

  if (weightFixRow) {
    return {
      selectedRow: weightFixRow,
      priceBy: "FIX",
      sizeMatchedRow: null,
      weightMatchedRow: null,
    };
  }

  const sizeMatchedRow = activeRows.find((row) => {
    return isValueInRange(q, row.size_min, row.size_max);
  });

  const weightMatchedRow = activeRows.find((row) => {
    return isValueInRange(weight, row.weight_min, row.weight_max);
  });

  if (!sizeMatchedRow && !weightMatchedRow) {
    return null;
  }

  if (sizeMatchedRow && !weightMatchedRow) {
    return {
      selectedRow: sizeMatchedRow,
      priceBy: "SIZE",
      sizeMatchedRow,
      weightMatchedRow: null,
    };
  }

  if (!sizeMatchedRow && weightMatchedRow) {
    return {
      selectedRow: weightMatchedRow,
      priceBy: "WEIGHT",
      sizeMatchedRow: null,
      weightMatchedRow,
    };
  }

  const sizeCost = toNumberOrZero(sizeMatchedRow.cost);
  const weightCost = toNumberOrZero(weightMatchedRow.cost);

  if (weightCost > sizeCost) {
    return {
      selectedRow: weightMatchedRow,
      priceBy: "WEIGHT",
      sizeMatchedRow,
      weightMatchedRow,
    };
  }

  return {
    selectedRow: sizeMatchedRow,
    priceBy: "SIZE",
    sizeMatchedRow,
    weightMatchedRow,
  };
};

export const getPackageByCode = async ({
  conn,
  customerId,
  packageCode,
  q,
  weight,
  cache,
}) => {
  const cleanCustomerId = toNumberOrNull(customerId);
  const cleanPackageCode = cleanCode(packageCode);

  if (!cleanCustomerId) {
    throw createImportError("ไม่พบ customer_id สำหรับค้นหา package");
  }

  if (!cleanPackageCode) {
    throw createImportError("ไม่พบ PACKAGE_CODE");
  }

  const cacheKey = `${cleanCustomerId}:${cleanPackageCode}`;

  let packageRows = cache.get(cacheKey);

  if (!packageRows) {
    const [rows] = await conn.query(
      `
        SELECT
          p.package_id,
          p.package_code,
          p.package_name,
          p.customer_id,
          p.is_document_return AS package_is_document_return,

          pb.id AS package_detail_id,
          pb.package_detail_code,
          pb.package_detail_name,
          pb.unit_id,
          pb.is_deleted AS business_is_deleted,
          pb.size_min,
          pb.size_max,
          pb.weight_min,
          pb.weight_max,
          pb.cost,
          pb.is_actived AS business_is_actived,
          pb.cost_difference_warehouse,
          pb.is_document_return AS detail_is_document_return,
          pb.cost_go,
          pb.cost_return,
          pb.is_weight_fix,
          pb.is_vat
        FROM mm_packages p
        INNER JOIN mm_package_business pb
          ON pb.package_id = p.package_id
        WHERE p.package_code = ?
          AND p.customer_id = ?
          AND p.is_deleted = 'N'
          AND p.is_actived = 'Y'
          AND pb.is_deleted = 'N'
        ORDER BY p.package_id ASC, pb.id ASC
      `,
      [cleanPackageCode, cleanCustomerId],
    );

    if (rows.length === 0) {
      throw createImportError(
        `ไม่พบ PACKAGE_CODE ${cleanPackageCode} ของ customer นี้ หรือ package ไม่ active`,
      );
    }

    packageRows = rows;
    cache.set(cacheKey, packageRows);
  }

  const matched = findMatchedPackageBusiness({
    businessRows: packageRows,
    q,
    weight,
  });

  if (!matched) {
    throw createImportError(
      `PACKAGE_CODE ${cleanPackageCode}: ไม่พบเรทราคาที่ตรงกับ Q=${q ?? "-"} / WEIGHT=${weight ?? "-"}`,
    );
  }

  const selected = matched.selectedRow;

  return {
    package_id: selected.package_id,
    package_code: selected.package_code,
    package_name: selected.package_name,

    package_detail_id: selected.package_detail_id,
    package_detail_code: selected.package_detail_code,
    package_detail_name: selected.package_detail_name,

    unit_id: selected.unit_id,

    cost: toNumberOrZero(selected.cost),
    cost_difference: toNumberOrZero(selected.cost_difference_warehouse),

    price_by: matched.priceBy,

    size_min: selected.size_min,
    size_max: selected.size_max,
    weight_min: selected.weight_min,
    weight_max: selected.weight_max,

    is_document_return:
      selected.detail_is_document_return ??
      selected.package_is_document_return ??
      null,
  };
};

export const buildImportDetailData = ({ receiveId, row, packageData }) => {
  return {
    receive_id: receiveId,

    package_id: packageData.package_id,
    package_detail_id: packageData.package_detail_id,
    package_name: packageData.package_name,

    unit_name: null,

    qty: 1,

    cost: packageData.cost,
    weight: row.weight,
    cost_difference: packageData.cost_difference,

    remark: row.note,

    width: row.width,
    height: row.height,
    length: row.length,

    cost_island: 0,
    cost_other: 0,

    q: row.q,

    size_type: null,

    is_document_return: row.is_document_return ?? packageData.is_document_return,
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

export const insertImportReceiveSerials = async (conn, receiveId) => {
  const cleanReceiveId = toNumberOrNull(receiveId);

  if (!cleanReceiveId) {
    throw createImportError("receive_id required for tm_receive_serials");
  }

  await conn.query(
    `
      INSERT INTO tm_receive_serials (
        receive_code,
        receive_business_id,
        receive_date,
        receive_walkin_id,
        delivery_date,

        serial_id,
        serial_no,

        package_id,
        package_name,
        package_detail_id,
        package_detail_name,

        customer_id,
        cost,

        from_warehouse_id,
        to_warehouse_id,

        recipient_name,
        recipient_code,
        address,

        district_id,
        district_name,
        subdistrict_id,
        subdistrict_name,
        province_id,
        province_name,

        zip_code,
        tel,

        item_is_deleted,

        recipient_id,
        shipper_id,
        shipper_name,

        document_return_id,
        remark,
        url,
        cod,

        weight,
        width,
        length,
        height,
        q,

        is_returned,
        payment_type_id,
        recipient_detail_id,
        recipient_detail_name,

        deleted_date,
        deleted_by_user,

        vol,
        size_type,

        last_modified,
        customer_type
      )
      SELECT
        h.receive_code,
        h.receive_id AS receive_business_id,
        h.receive_date,
        NULL AS receive_walkin_id,
        h.delivery_date,

        i.serial_id,
        i.serial_no,

        d.package_id,
        d.package_name,
        d.package_detail_id,
        pb.package_detail_name,

        h.customer_id,
        d.cost,

        h.from_warehouse_id,
        h.to_warehouse_id,

        h.recipient_name,
        NULL AS recipient_code,
        h.address,

        h.district_id,
        ma.district_name,
        h.subdistrict_id,
        ma.subdistrict_name,
        h.province_id,
        ma.province_name,

        h.zip_code,
        h.tel,

        COALESCE(i.is_deleted, 'N') AS item_is_deleted,

        NULL AS recipient_id,
        h.shipper_id,
        s.shipper_name,

        h.document_return AS document_return_id,
        h.remark,
        NULL AS url,
        h.cod,

        d.weight,
        d.width,
        d.length,
        d.height,
        d.q,

        'N' AS is_returned,
        h.payment_type_id,
        NULL AS recipient_detail_id,
        NULL AS recipient_detail_name,

        NULL AS deleted_date,
        NULL AS deleted_by_user,

        NULL AS vol,
        d.size_type,

         NOW() AS last_modified,
        'BUSINESS' AS customer_type
      FROM tm_receive_import_head h
      INNER JOIN tm_receive_import_details d
        ON d.receive_id = h.receive_id
      LEFT JOIN tm_receive_import_detail_items i
        ON i.receive_detail_id = d.receive_detail_id
      LEFT JOIN mm_package_business pb
        ON pb.id = d.package_detail_id
      LEFT JOIN mm_master_addresses ma
        ON ma.subdistrict_id = h.subdistrict_id
      LEFT JOIN mm_shippers s
        ON s.shipper_id = h.shipper_id
      WHERE h.receive_id = ?
    `,
    [cleanReceiveId],
  );
};