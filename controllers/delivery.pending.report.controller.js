import db from "../config/db.js";
import { buildLike, cleanDbText, toNumberOrNull } from "../utils/cleanText.js";
import { formatDateTime } from "../utils/formatDate.js";

const getDateRange = (query) => {
  const dateFromValue = cleanDbText(query.date_from);
  const dateToValue = cleanDbText(query.date_to);

  return {
    dateFrom: formatDateTime(dateFromValue ? `${dateFromValue} 00:00:00` : null),
    dateTo: formatDateTime(dateToValue ? `${dateToValue} 23:59:59` : dateFromValue ? `${dateFromValue} 23:59:59` : null),
  };
};

const buildSerialFilter = ({ parentCondition, query }) => {
  const search = cleanDbText(query.search);
  const toWarehouseId = toNumberOrNull(query.to_warehouse_id);
  const { dateFrom, dateTo } = getDateRange(query);
  const where = [parentCondition];
  const params = [];

  if (toWarehouseId !== null) {
    where.push("serial_report.to_warehouse_id = ?");
    params.push(toWarehouseId);
  }

  if (dateFrom) {
    where.push("serial_report.delivery_date >= ?");
    params.push(dateFrom);
  }

  if (dateTo) {
    where.push("serial_report.delivery_date <= ?");
    params.push(dateTo);
  }

  return { search, serialWhere: where, params };
};

const serialSearchSql = (search) => `(
  ${buildLike("serial_report.receive_code", search)}
  OR ${buildLike("serial_report.serial_no", search)}
  OR ${buildLike("serial_report.reference_no", search)}
)`;

export const getDeliveryReportByDt = async (req, res) => {
  try {
    const search = cleanDbText(req.query.search);
    const requestedDeliveryStatus = cleanDbText(req.query.delivery_status)?.toUpperCase();
    const deliveryStatus =
      requestedDeliveryStatus === "ALL" || requestedDeliveryStatus === "PENDING" || requestedDeliveryStatus === "DELIVERED"
        ? requestedDeliveryStatus
        : "PENDING";
    const { dateFrom, dateTo } = getDateRange(req.query);
    const where = [];
    const params = [];

    if (search) {
      where.push(`(
        ${buildLike("report.truck_code", search)}
        OR ${buildLike("report.driver_name", search)}
        OR ${buildLike("report.username", search)}
        OR ${buildLike("report.license_plate", search)}
      )`);
    }

    if (dateFrom) {
      where.push("report.created_date >= ?");
      params.push(dateFrom);
    }

    if (dateTo) {
      where.push("report.created_date <= ?");
      params.push(dateTo);
    }

    if (deliveryStatus === "DELIVERED") {
      where.push("COALESCE(report.total_sn, 0) > 0");
      where.push("COALESCE(report.delivered_sn, 0) >= COALESCE(report.total_sn, 0)");
    } else if (deliveryStatus === "PENDING") {
      where.push("COALESCE(report.delivered_sn, 0) < COALESCE(report.total_sn, 0)");
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [rows] = await db.query(
      `
        SELECT report.*
        FROM vw_delivery_report_dt report
        ${whereSql}
        ORDER BY report.created_date DESC, report.truck_code DESC
      `,
      params,
    );

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("getDeliveryReportByDt error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดรายงานตามใบรถกระจายได้" });
  }
};

export const getDeliveryReportByReceive = async (req, res) => {
  try {
    const { search, serialWhere, params } = buildSerialFilter({
      parentCondition: "serial_report.receive_business_id = report.receive_business_id",
      query: req.query,
    });

    const where = [];

    if (search) {
      where.push(`(
        ${buildLike("report.receive_code", search)}
        OR ${buildLike("report.reference_no", search)}
        OR EXISTS (
          SELECT 1
          FROM vw_delivery_report_sn serial_report
          WHERE serial_report.receive_business_id = report.receive_business_id
            AND ${serialSearchSql(search)}
        )
      )`);
    }

    if (serialWhere.length > 1) {
      where.push(`EXISTS (
        SELECT 1
        FROM vw_delivery_report_sn serial_report
        WHERE ${serialWhere.join(" AND ")}
      )`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [rows] = await db.query(
      `
        SELECT
          report.*,
          GREATEST(COALESCE(report.total_sn, 0) - COALESCE(report.delivered_sn, 0), 0) AS pending_sn
        FROM vw_delivery_report_receive report
        ${whereSql}
        ORDER BY report.delivery_date DESC, report.receive_code DESC
      `,
      params,
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("getDeliveryReportByReceive error:", error);

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถโหลดรายงานตามเลขที่บิลได้",
    });
  }
};

export const getDeliveryReportBySn = async (req, res) => {
  try {
    const search = cleanDbText(req.query.search);
    const toWarehouseId = toNumberOrNull(req.query.to_warehouse_id);
    const deliveryStatus = cleanDbText(req.query.delivery_status)?.toUpperCase();
    const { dateFrom, dateTo } = getDateRange(req.query);
    const where = [];
    const params = [];

    if (search) {
      where.push(`(
        ${buildLike("report.receive_code", search)}
        OR ${buildLike("report.serial_no", search)}
        OR ${buildLike("report.reference_no", search)}
      )`);
    }

    if (toWarehouseId !== null) {
      where.push("report.to_warehouse_id = ?");
      params.push(toWarehouseId);
    }

    if (deliveryStatus === "DELIVERED") {
      where.push("report.status_id = 18");
    } else if (deliveryStatus === "PENDING") {
      where.push("COALESCE(report.status_id, 0) <> 18");
    }

    if (dateFrom) {
      where.push("report.delivery_date >= ?");
      params.push(dateFrom);
    }

    if (dateTo) {
      where.push("report.delivery_date <= ?");
      params.push(dateTo);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [rows] = await db.query(
      `
        SELECT report.*
        FROM vw_delivery_report_sn report
        ${whereSql}
        ORDER BY report.delivery_date DESC, report.receive_code DESC, report.serial_no ASC
      `,
      params,
    );

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("getDeliveryReportBySn error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดรายงานตาม Serial No ได้" });
  }
};
