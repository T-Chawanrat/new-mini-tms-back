// server/controllers/receive.report.controller.js

import db from "../config/db.js";
import { buildLike, cleanValue, toNumberOrNull } from "../utils/cleanText.js";
import { formatDateOnly, formatDateTime } from "../utils/formatDate.js";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const toPositiveInt = (value, fallback) => {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return fallback;
  }

  return Math.floor(numberValue);
};

const addWhere = (where, condition) => {
  if (condition) where.push(condition);
};

const buildReceiveReportWhere = (query) => {
  const where = [];
  const params = [];

  const receiveCode = cleanValue(query.receive_code);
  const serialNo = cleanValue(query.serial_no);
  const recipientName = cleanValue(query.recipient_name);
  const recipientCode = cleanValue(query.recipient_code);
  const tel = cleanValue(query.tel);
  const shipperName = cleanValue(query.shipper_name);
  const packageName = cleanValue(query.package_name);
  const provinceName = cleanValue(query.province_name);

  const customerId = toNumberOrNull(query.customer_id);
  const shipperId = toNumberOrNull(query.shipper_id);
  const fromWarehouseId = toNumberOrNull(query.from_warehouse_id);
  const toWarehouseId = toNumberOrNull(query.to_warehouse_id);
  const provinceId = toNumberOrNull(query.province_id);
  const packageId = toNumberOrNull(query.package_id);
  const packageDetailId = toNumberOrNull(query.package_detail_id);

  const deliveryDateFrom = formatDateOnly(query.delivery_date_from);
  const deliveryDateTo = formatDateOnly(query.delivery_date_to);

  const receiveDateFrom = formatDateTime(
    query.receive_date_from ? `${query.receive_date_from} 00:00:00` : null
  );

  const receiveDateTo = formatDateTime(
    query.receive_date_to ? `${query.receive_date_to} 23:59:59` : null
  );

  const itemIsDeleted = cleanValue(query.item_is_deleted);
  const isReturned = cleanValue(query.is_returned);
  const sizeType = cleanValue(query.size_type);
  const customerType = cleanValue(query.customer_type);

  if (receiveCode) {
    addWhere(where, buildLike("receive_code", receiveCode));
  }

  if (serialNo) {
    addWhere(where, buildLike("serial_no", serialNo));
  }

  if (recipientName) {
    addWhere(where, buildLike("recipient_name", recipientName));
  }

  if (recipientCode) {
    addWhere(where, buildLike("recipient_code", recipientCode));
  }

  if (tel) {
    addWhere(where, buildLike("tel", tel));
  }

  if (shipperName) {
    addWhere(where, buildLike("shipper_name", shipperName));
  }

  if (packageName) {
    addWhere(where, buildLike("package_name", packageName));
  }

  if (provinceName) {
    addWhere(where, buildLike("province_name", provinceName));
  }

  if (customerId !== null) {
    where.push("customer_id = ?");
    params.push(customerId);
  }

  if (shipperId !== null) {
    where.push("shipper_id = ?");
    params.push(shipperId);
  }

  if (fromWarehouseId !== null) {
    where.push("from_warehouse_id = ?");
    params.push(fromWarehouseId);
  }

  if (toWarehouseId !== null) {
    where.push("to_warehouse_id = ?");
    params.push(toWarehouseId);
  }

  if (provinceId !== null) {
    where.push("province_id = ?");
    params.push(provinceId);
  }

  if (packageId !== null) {
    where.push("package_id = ?");
    params.push(packageId);
  }

  if (packageDetailId !== null) {
    where.push("package_detail_id = ?");
    params.push(packageDetailId);
  }

  if (deliveryDateFrom) {
    where.push("delivery_date >= ?");
    params.push(deliveryDateFrom);
  }

  if (deliveryDateTo) {
    where.push("delivery_date <= ?");
    params.push(deliveryDateTo);
  }

  if (receiveDateFrom) {
    where.push("receive_date >= ?");
    params.push(receiveDateFrom);
  }

  if (receiveDateTo) {
    where.push("receive_date <= ?");
    params.push(receiveDateTo);
  }

  if (isReturned) {
    where.push("is_returned = ?");
    params.push(isReturned);
  }

  if (sizeType) {
    where.push("size_type = ?");
    params.push(sizeType);
  }

  if (customerType) {
    where.push("customer_type = ?");
    params.push(customerType);
  }

  if (itemIsDeleted) {
    where.push("item_is_deleted = ?");
    params.push(itemIsDeleted);
  } else {
    where.push(`
      (
        item_is_deleted IS NULL
        OR item_is_deleted = ''
        OR item_is_deleted = 'N'
        OR item_is_deleted = '0'
      )
    `);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
};

export const getReceiveReport = async (req, res) => {
  try {
    const page = toPositiveInt(req.query.page, DEFAULT_PAGE);
    const rawLimit = toPositiveInt(req.query.limit, DEFAULT_LIMIT);
    const limit = Math.min(rawLimit, MAX_LIMIT);
    const offset = (page - 1) * limit;

    const { whereSql, params } = buildReceiveReportWhere(req.query);

    const countSql = `
      SELECT COUNT(*) AS total
      FROM tm_receive_serials
      ${whereSql}
    `;

    const dataSql = `
      SELECT
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
        customer_type,

        cost,
        cod,

        from_warehouse_id,
        to_warehouse_id,

        recipient_id,
        recipient_code,
        recipient_name,

        recipient_detail_id,
        recipient_detail_name,

        address,
        subdistrict_id,
        subdistrict_name,
        district_id,
        district_name,
        province_id,
        province_name,
        zip_code,
        tel,

        shipper_id,
        shipper_name,

        document_return_id,
        remark,
        url,

        weight,
        width,
        length,
        height,
        q,
        vol,
        size_type,

        is_returned,
        payment_type_id,

        item_is_deleted,
        deleted_date,
        deleted_by_user,

        create_date_1_2,
        last_modified

      FROM tm_receive_serials
      ${whereSql}
      ORDER BY receive_date DESC, receive_code DESC, serial_no ASC
      LIMIT ? OFFSET ?
    `;

    const [countRows] = await db.query(countSql, params);
    const [rows] = await db.query(dataSql, [...params, limit, offset]);

    const total = Number(countRows?.[0]?.total || 0);

    res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("getReceiveReport error:", error);

    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูล Receive Report",
    });
  }
};

export const getReceiveReportSummary = async (req, res) => {
  try {
    const { whereSql, params } = buildReceiveReportWhere(req.query);

    const sql = `
      SELECT
        COUNT(*) AS total_rows,
        COUNT(DISTINCT receive_code) AS total_receive,
        COUNT(DISTINCT serial_no) AS total_serial,
        COUNT(DISTINCT recipient_id) AS total_recipient,

        COALESCE(SUM(cost), 0) AS total_cost,
        COALESCE(SUM(cod), 0) AS total_cod,
        COALESCE(SUM(weight), 0) AS total_weight,
        COALESCE(SUM(q), 0) AS total_qty,
        COALESCE(SUM(vol), 0) AS total_vol,

        COUNT(DISTINCT customer_id) AS total_customer,
        COUNT(DISTINCT shipper_id) AS total_shipper,
        COUNT(DISTINCT from_warehouse_id) AS total_from_warehouse,
        COUNT(DISTINCT to_warehouse_id) AS total_to_warehouse
      FROM tm_receive_serials
      ${whereSql}
    `;

    const [rows] = await db.query(sql, params);

    res.json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("getReceiveReportSummary error:", error);

    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลสรุป Receive Report",
    });
  }
};