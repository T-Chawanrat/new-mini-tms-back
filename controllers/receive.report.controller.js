// server/controllers/receive.report.controller.js

import db from "../config/db.js";
import { cleanValue } from "../utils/cleanText.js";
import { formatDateTime } from "../utils/formatDate.js";

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

const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return null;
  }

  return numberValue;
};

const activeItemWhere = (alias = "t") => {
  return `
    (
      ${alias}.item_is_deleted IS NULL
      OR ${alias}.item_is_deleted = ''
      OR ${alias}.item_is_deleted = 'N'
      OR ${alias}.item_is_deleted = '0'
    )
  `;
};

const buildReceiveReportWhere = (query, alias = "t") => {
  const where = [];
  const params = [];

  const receiveCode = cleanValue(query.receive_code);
  const serialNo = cleanValue(query.serial_no);
  const customerId = toNumberOrNull(query.customer_id);
  const toWarehouseId = toNumberOrNull(query.to_warehouse_id);

  const receiveDateFrom = formatDateTime(query.receive_date_from ? `${query.receive_date_from} 00:00:00` : null);

  const receiveDateTo = formatDateTime(
    query.receive_date_to ? `${query.receive_date_to} 23:59:59` : query.receive_date_from ? `${query.receive_date_from} 23:59:59` : null,
  );

  where.push(activeItemWhere(alias));

  if (receiveDateFrom) {
    where.push(`${alias}.receive_date >= ?`);
    params.push(receiveDateFrom);
  }

  if (receiveDateTo) {
    where.push(`${alias}.receive_date <= ?`);
    params.push(receiveDateTo);
  }

  if (receiveCode) {
    where.push(`${alias}.receive_code LIKE ?`);
    params.push(`%${receiveCode}%`);
  }

  if (customerId !== null) {
    where.push(`${alias}.customer_id = ?`);
    params.push(customerId);
  }

  if (toWarehouseId !== null) {
    where.push(`${alias}.to_warehouse_id = ?`);
    params.push(toWarehouseId);
  }

  if (serialNo) {
    where.push(`
      EXISTS (
        SELECT 1
        FROM tm_receive_serials sx
        WHERE sx.receive_business_id = ${alias}.receive_business_id
          AND sx.serial_no LIKE ?
          AND ${activeItemWhere("sx")}
      )
    `);
    params.push(`%${serialNo}%`);
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

    const { whereSql, params } = buildReceiveReportWhere(req.query, "t");

    const countSql = `
      SELECT COUNT(*) AS total
      FROM (
        SELECT
          t.receive_business_id,
          t.receive_code
        FROM tm_receive_serials t
        ${whereSql}
        GROUP BY
          t.receive_business_id,
          t.receive_code
      ) x
    `;

    const dataSql = `
      SELECT
        t.receive_code,
        t.receive_business_id,

        MIN(t.receive_date) AS receive_date,
        MIN(t.receive_walkin_id) AS receive_walkin_id,
        MIN(t.delivery_date) AS delivery_date,

        MIN(t.customer_id) AS customer_id,
        MIN(c.name) AS customer_name,
        MIN(t.customer_type) AS customer_type,

        MIN(t.from_warehouse_id) AS from_warehouse_id,
        MIN(t.to_warehouse_id) AS to_warehouse_id,
        MIN(wt.warehouse_name) AS to_warehouse_name,

        MIN(t.recipient_id) AS recipient_id,
        MIN(t.recipient_code) AS recipient_code,
        MIN(t.recipient_name) AS recipient_name,

        MIN(t.address) AS address,
        MIN(t.district_id) AS district_id,
        MIN(t.district_name) AS district_name,
        MIN(t.subdistrict_id) AS subdistrict_id,
        MIN(t.subdistrict_name) AS subdistrict_name,
        MIN(t.province_id) AS province_id,
        MIN(t.province_name) AS province_name,
        MIN(t.zip_code) AS zip_code,
        MIN(t.tel) AS tel,

        MIN(t.shipper_id) AS shipper_id,
        MIN(t.shipper_name) AS shipper_name,

        MIN(t.payment_type_id) AS payment_type_id,
        MIN(t.recipient_detail_id) AS recipient_detail_id,
        MIN(t.recipient_detail_name) AS recipient_detail_name,

        COUNT(*) AS total_rows,
        COUNT(DISTINCT t.serial_no) AS total_serial,

        COALESCE(SUM(t.cost), 0) AS total_cost,
        COALESCE(SUM(t.cod), 0) AS total_cod,
        COALESCE(SUM(t.weight), 0) AS total_weight,
        COALESCE(SUM(t.q), 0) AS total_qty,
        COALESCE(SUM(t.vol), 0) AS total_vol,

        MAX(t.create_date_1_2) AS create_date_1_2,
        MAX(t.last_modified) AS last_modified

      FROM tm_receive_serials t
      LEFT JOIN mm_customers c
        ON c.id = t.customer_id
      LEFT JOIN mm_warehouses_to wt
        ON wt.warehouse_id = t.to_warehouse_id
      ${whereSql}
      GROUP BY
        t.receive_business_id,
        t.receive_code
      ORDER BY
        MIN(t.receive_date) DESC,
        t.receive_code DESC
      LIMIT ? OFFSET ?
    `;

    const [countRows] = await db.query(countSql, params);
    const [receiveRows] = await db.query(dataSql, [...params, limit, offset]);

    let data = receiveRows;

    if (receiveRows.length > 0) {
      const receiveBusinessIds = receiveRows.map((row) => row.receive_business_id).filter((id) => id !== null && id !== undefined);

      if (receiveBusinessIds.length > 0) {
        const placeholders = receiveBusinessIds.map(() => "?").join(",");

        const serialSql = `
          SELECT
            t.receive_code,
            t.receive_business_id,
            t.receive_date,
            t.receive_walkin_id,
            t.delivery_date,

            t.serial_id,
            t.serial_no,

            t.package_id,
            t.package_name,
            t.package_detail_id,
            t.package_detail_name,

            t.customer_id,
            t.cost,

            t.from_warehouse_id,
            t.to_warehouse_id,
            wt.warehouse_name AS to_warehouse_name,

            t.recipient_name,
            t.recipient_code,
            t.address,

            t.district_id,
            t.district_name,
            t.subdistrict_id,
            t.subdistrict_name,
            t.province_id,
            t.province_name,
            t.zip_code,
            t.tel,

            t.item_is_deleted,

            t.recipient_id,
            t.shipper_id,
            t.shipper_name,

            t.document_return_id,
            t.remark,
            t.url,

            t.cod,
            t.weight,
            t.width,
            t.length,
            t.height,
            t.q,

            t.is_returned,
            t.payment_type_id,

            t.recipient_detail_id,
            t.recipient_detail_name,

            t.deleted_date,
            t.deleted_by_user,

            t.vol,
            t.size_type,

            t.create_date_1_2,
            t.last_modified,
            t.customer_type

          FROM tm_receive_serials t
          LEFT JOIN mm_warehouses_to wt
            ON wt.warehouse_id = t.to_warehouse_id
          WHERE t.receive_business_id IN (${placeholders})
            AND ${activeItemWhere("t")}
          ORDER BY
            t.receive_code DESC,
            t.serial_no ASC
        `;

        const [serialRows] = await db.query(serialSql, receiveBusinessIds);

        const serialMap = serialRows.reduce((map, row) => {
          const key = String(row.receive_business_id);

          if (!map[key]) {
            map[key] = [];
          }

          map[key].push(row);

          return map;
        }, {});

        data = receiveRows.map((row) => {
          const key = String(row.receive_business_id);

          return {
            ...row,
            serials: serialMap[key] || [],
          };
        });
      }
    }

    const total = Number(countRows?.[0]?.total || 0);

    return res.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("getReceiveReport error:", error);

    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูล Receive Report",
    });
  }
};

export const getReceiveReportSerials = async (req, res) => {
  try {
    const receiveBusinessId = toNumberOrNull(req.params.receiveBusinessId);

    if (!receiveBusinessId) {
      return res.status(400).json({
        success: false,
        message: "receiveBusinessId ไม่ถูกต้อง",
      });
    }

    const sql = `
      SELECT
        t.receive_code,
        t.receive_business_id,
        t.receive_date,
        t.receive_walkin_id,
        t.delivery_date,

        t.serial_id,
        t.serial_no,

        t.package_id,
        t.package_name,
        t.package_detail_id,
        t.package_detail_name,

        t.customer_id,
        t.cost,

        t.from_warehouse_id,
        t.to_warehouse_id,
        wt.warehouse_name AS to_warehouse_name,

        t.recipient_name,
        t.recipient_code,
        t.address,

        t.district_id,
        t.district_name,
        t.subdistrict_id,
        t.subdistrict_name,
        t.province_id,
        t.province_name,
        t.zip_code,
        t.tel,

        t.item_is_deleted,

        t.recipient_id,
        t.shipper_id,
        t.shipper_name,

        t.document_return_id,
        t.remark,
        t.url,

        t.cod,
        t.weight,
        t.width,
        t.length,
        t.height,
        t.q,

        t.is_returned,
        t.payment_type_id,

        t.recipient_detail_id,
        t.recipient_detail_name,

        t.deleted_date,
        t.deleted_by_user,

        t.vol,
        t.size_type,

        t.create_date_1_2,
        t.last_modified,
        t.customer_type

      FROM tm_receive_serials t
      LEFT JOIN mm_warehouses_to wt
        ON wt.warehouse_id = t.to_warehouse_id
      WHERE t.receive_business_id = ?
        AND ${activeItemWhere("t")}
      ORDER BY
        t.serial_no ASC
    `;

    const [rows] = await db.query(sql, [receiveBusinessId]);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("getReceiveReportSerials error:", error);

    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูล Serial No",
    });
  }
};

export const getReceiveReportSummary = async (req, res) => {
  try {
    const { whereSql, params } = buildReceiveReportWhere(req.query, "t");

    const totalSql = `
      SELECT
        COUNT(DISTINCT t.receive_business_id) AS total_receive,
        COUNT(DISTINCT t.serial_no) AS total_serial,
        COUNT(*) AS total_rows,

        COALESCE(SUM(t.cost), 0) AS total_cost,
        COALESCE(SUM(t.cod), 0) AS total_cod,
        COALESCE(SUM(t.weight), 0) AS total_weight,
        COALESCE(SUM(t.q), 0) AS total_qty,
        COALESCE(SUM(t.vol), 0) AS total_vol
      FROM tm_receive_serials t
      ${whereSql}
    `;

    const dailySql = `
      SELECT
        DATE(t.receive_date) AS receive_date,

        COUNT(DISTINCT t.receive_business_id) AS total_receive,
        COUNT(DISTINCT t.serial_no) AS total_serial,
        COUNT(*) AS total_rows,

        COALESCE(SUM(t.cost), 0) AS total_cost,
        COALESCE(SUM(t.cod), 0) AS total_cod,
        COALESCE(SUM(t.weight), 0) AS total_weight,
        COALESCE(SUM(t.q), 0) AS total_qty,
        COALESCE(SUM(t.vol), 0) AS total_vol
      FROM tm_receive_serials t
      ${whereSql}
      GROUP BY DATE(t.receive_date)
      ORDER BY DATE(t.receive_date) DESC
    `;

    const [totalRows] = await db.query(totalSql, params);
    const [dailyRows] = await db.query(dailySql, params);

    return res.json({
      success: true,
      data: {
        total: totalRows[0],
        daily: dailyRows,
      },
    });
  } catch (error) {
    console.error("getReceiveReportSummary error:", error);

    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลสรุป Receive Report",
    });
  }
};
