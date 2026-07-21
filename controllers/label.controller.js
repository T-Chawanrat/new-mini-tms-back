import db from "../config/db.js";

import {
  buildLike,
  cleanDbText,
  toNumberOrNull,
} from "../utils/cleanText.js";

const getPagination = (page, limit) => {
  const pageNum = Math.max(Number(page) || 1, 1);
  const limitNum = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const offset = (pageNum - 1) * limitNum;

  return {
    pageNum,
    limitNum,
    offset,
  };
};

const activeSerialCondition = `
  (
    rs.item_is_deleted IS NULL
    OR rs.item_is_deleted = ''
    OR rs.item_is_deleted = '0'
    OR LOWER(rs.item_is_deleted) = 'false'
    OR LOWER(rs.item_is_deleted) = 'n'
    OR LOWER(rs.item_is_deleted) = 'no'
  )
`;

const getPrintSummaryJoinSql = () => {
  return `
    LEFT JOIN (
      SELECT
        serial_no,
        COUNT(*) AS total_print_count,
        SUM(
          CASE
            WHEN print_type = 'REPRINT' THEN 1
            ELSE 0
          END
        ) AS reprint_count,
        MAX(created_at) AS last_printed_at
      FROM logs_label_print
      GROUP BY serial_no
    ) lp
      ON lp.serial_no = rs.serial_no
  `;
};

const getMasterJoinSql = () => {
  return `
    LEFT JOIN mm_customers c
      ON c.id = rs.customer_id

    LEFT JOIN mm_warehouses_to wt
      ON wt.warehouse_id = rs.to_warehouse_id

    LEFT JOIN mm_warehouses_to wf
      ON wf.warehouse_id = rs.from_warehouse_id

    LEFT JOIN (
      SELECT
        receive_id,
        MAX(reference_no) AS reference_no
      FROM tm_receive_references
      GROUP BY receive_id
    ) ref
      ON ref.receive_id = CASE
        WHEN UPPER(rs.customer_type) = 'BUSINESS'
          THEN rs.receive_business_id
        WHEN UPPER(rs.customer_type) = 'EXPRESS'
          THEN rs.receive_walkin_id
        ELSE NULL
      END

    LEFT JOIN mm_recipient_details rd
      ON rd.recipient_detail_id = rs.recipient_detail_id

    LEFT JOIN mm_shippers s
      ON s.shipper_id = rs.shipper_id
  `;
};

const getToWarehouseNameSelectSql = () => {
  return `
    COALESCE(
      NULLIF(wt.warehouse_name, ''),
      NULLIF(wt.label_name, ''),
      wt.warehouse_code
    )
  `;
};

const getFromWarehouseNameSelectSql = () => {
  return `
    COALESCE(
      NULLIF(wf.warehouse_name, ''),
      NULLIF(wf.label_name, ''),
      wf.warehouse_code
    )
  `;
};

const buildReceiveWhere = (query) => {
  const {
    receive_date,
    customer_id,
    to_warehouse_id,
    receive_code,
    serial_no,
  } = query;

  const where = [];
  const params = [];

  where.push("rs.receive_code IS NOT NULL");
  where.push("rs.receive_code <> ''");
  where.push("rs.serial_no IS NOT NULL");
  where.push("rs.serial_no <> ''");
  where.push(activeSerialCondition);

  if (receive_date) {
    where.push("DATE(rs.receive_date) = ?");
    params.push(receive_date);
  }

  if (customer_id) {
    where.push("rs.customer_id = ?");
    params.push(customer_id);
  }

  if (to_warehouse_id) {
    where.push("rs.to_warehouse_id = ?");
    params.push(to_warehouse_id);
  }

  if (receive_code) {
    where.push(buildLike("rs.receive_code", receive_code));
  }

  if (serial_no) {
    where.push(buildLike("rs.serial_no", serial_no));
  }

  return {
    whereSql: `WHERE ${where.join(" AND ")}`,
    params,
  };
};

const buildSerialWhere = (query) => {
  const {
    receive_code,
    serial_no,
    customer_id,
    to_warehouse_id,
    receive_date,
  } = query;

  const where = [];
  const params = [];

  where.push("rs.receive_code IS NOT NULL");
  where.push("rs.receive_code <> ''");
  where.push("rs.serial_no IS NOT NULL");
  where.push("rs.serial_no <> ''");
  where.push(activeSerialCondition);

  if (receive_code) {
    where.push("rs.receive_code = ?");
    params.push(receive_code);
  }

  if (serial_no) {
    where.push(buildLike("rs.serial_no", serial_no));
  }

  if (customer_id) {
    where.push("rs.customer_id = ?");
    params.push(customer_id);
  }

  if (to_warehouse_id) {
    where.push("rs.to_warehouse_id = ?");
    params.push(to_warehouse_id);
  }

  if (receive_date) {
    where.push("DATE(rs.receive_date) = ?");
    params.push(receive_date);
  }

  return {
    whereSql: `WHERE ${where.join(" AND ")}`,
    params,
  };
};

export const getLabelReceives = async (req, res) => {
  try {
    const { page = "1", limit = "50" } = req.query;

    const { pageNum, limitNum, offset } = getPagination(page, limit);
    const { whereSql, params } = buildReceiveWhere(req.query);

    const toWarehouseNameSql = getToWarehouseNameSelectSql();

    const [rows] = await db.query(
      `
      SELECT
        rs.receive_code,
        MAX(rs.receive_business_id) AS receive_business_id,
        MAX(ref.reference_no) AS reference_no,
        MIN(rs.receive_date) AS receive_date,
        MIN(rs.delivery_date) AS delivery_date,

        rs.customer_id,
        c.name AS customer_name,

        rs.to_warehouse_id,
        ${toWarehouseNameSql} AS to_warehouse_name,

        COUNT(*) AS total_serial,

        SUM(
          CASE
            WHEN COALESCE(lp.total_print_count, 0) > 0 THEN 1
            ELSE 0
          END
        ) AS printed_serial,

        SUM(
          CASE
            WHEN COALESCE(lp.total_print_count, 0) = 0 THEN 1
            ELSE 0
          END
        ) AS not_printed_serial,

        SUM(
          COALESCE(lp.total_print_count, 0)
        ) AS total_print_count,

        SUM(
          COALESCE(lp.reprint_count, 0)
        ) AS total_reprint_count,

        MAX(lp.last_printed_at) AS last_printed_at

      FROM tm_receive_serials rs

      ${getMasterJoinSql()}
      ${getPrintSummaryJoinSql()}

      ${whereSql}

      GROUP BY
        rs.receive_code,
        rs.customer_id,
        c.name,
        rs.to_warehouse_id,
        ${toWarehouseNameSql}

      ORDER BY
        MIN(rs.receive_date) DESC,
        rs.receive_code DESC

      LIMIT ? OFFSET ?
      `,
      [...params, limitNum, offset],
    );

    const [countRows] = await db.query(
      `
      SELECT
        COUNT(*) AS total

      FROM (
        SELECT
          rs.receive_code

        FROM tm_receive_serials rs

        ${getMasterJoinSql()}
        ${getPrintSummaryJoinSql()}

        ${whereSql}

        GROUP BY
          rs.receive_code
      ) x
      `,
      params,
    );

    const total = Number(countRows?.[0]?.total || 0);

    return res.json({
      success: true,
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (error) {
    console.error("getLabelReceives error:", error);

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถดึงรายการ receive สำหรับ label ได้",
      error: error.message,
    });
  }
};

export const getLabelSerials = async (req, res) => {
  try {
    const { page = "1", limit = "500" } = req.query;

    const { pageNum, limitNum, offset } = getPagination(page, limit);
    const { whereSql, params } = buildSerialWhere(req.query);

    const toWarehouseNameSql = getToWarehouseNameSelectSql();
    const fromWarehouseNameSql = getFromWarehouseNameSelectSql();

    const [rows] = await db.query(
      `
      SELECT
        rs.receive_code,
        rs.receive_business_id,
        ref.reference_no,
        rs.receive_date,
        rs.delivery_date,

        rs.serial_id,
        rs.serial_no,

        rs.customer_id,
        c.name AS customer_name,

        rs.from_warehouse_id,
        ${fromWarehouseNameSql} AS from_warehouse_name,

        rs.to_warehouse_id,
        ${toWarehouseNameSql} AS to_warehouse_name,

        rs.recipient_id,
        rs.recipient_name,
        rs.recipient_code,

        rs.recipient_detail_id,
        rd.recipient_detail_name,
        rd.tel1 AS recipient_detail_tel,

        rs.address,
        rs.subdistrict_name,
        rs.district_name,
        rs.province_name,
        rs.zip_code,
        rs.tel,

        rs.shipper_id,
        rs.shipper_name,
        s.tel AS shipper_tel,

        rs.cod,
        rs.cost,
        rs.weight,
        rs.width,
        rs.length,
        rs.height,
        rs.q,
        rs.remark,

        COALESCE(
          lp.total_print_count,
          0
        ) AS print_count,

        COALESCE(
          lp.reprint_count,
          0
        ) AS reprint_count,

        lp.last_printed_at,

        CASE
          WHEN COALESCE(lp.total_print_count, 0) > 0 THEN 1
          ELSE 0
        END AS is_printed

      FROM tm_receive_serials rs

      ${getMasterJoinSql()}
      ${getPrintSummaryJoinSql()}

      ${whereSql}

      ORDER BY
        rs.serial_no ASC

      LIMIT ? OFFSET ?
      `,
      [...params, limitNum, offset],
    );

    const [countRows] = await db.query(
      `
      SELECT
        COUNT(*) AS total

      FROM tm_receive_serials rs

      ${getMasterJoinSql()}
      ${getPrintSummaryJoinSql()}

      ${whereSql}
      `,
      params,
    );

    const total = Number(countRows?.[0]?.total || 0);

    return res.json({
      success: true,
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (error) {
    console.error("getLabelSerials error:", error);

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถดึง serial สำหรับ label ได้",
      error: error.message,
    });
  }
};

export const markLabelsPrinted = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const {
      items,
      printed_by_user,
      is_reprint,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุรายการ serial_no ที่ต้องการบันทึกการปริ้น",
      });
    }

    const serialNos = [
      ...new Set(
        items
          .map((item) => cleanDbText(item.serial_no))
          .filter(Boolean),
      ),
    ];

    if (serialNos.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ไม่พบ serial_no ที่ถูกต้อง",
      });
    }

    await connection.beginTransaction();

    const placeholders = serialNos
      .map(() => "?")
      .join(",");

    const [serialRows] = await connection.query(
      `
      SELECT
        receive_code,
        serial_id,
        serial_no,
        customer_id,
        to_warehouse_id,
        recipient_code

      FROM tm_receive_serials rs

      WHERE
        rs.serial_no IN (${placeholders})
        AND rs.serial_no IS NOT NULL
        AND rs.serial_no <> ''
        AND ${activeSerialCondition}
      `,
      serialNos,
    );

    if (!serialRows.length) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "ไม่พบ serial_no สำหรับบันทึกการปริ้น",
      });
    }

    const foundSerialNoSet = new Set(
      serialRows.map((row) => row.serial_no),
    );

    const notFoundSerialNos = serialNos.filter(
      (serialNo) => !foundSerialNoSet.has(serialNo),
    );

    const printType = is_reprint
      ? "REPRINT"
      : "PRINT";

    const printedByUser = toNumberOrNull(
      printed_by_user,
    );

    const insertValues = serialRows.map((row) => [
      row.receive_code || null,
      row.serial_id || null,
      row.serial_no,
      row.customer_id || null,
      row.to_warehouse_id || null,
      row.recipient_code || null,
      printedByUser,
      printType,
    ]);

    await connection.query(
      `
      INSERT INTO logs_label_print (
        receive_code,
        serial_id,
        serial_no,
        customer_id,
        to_warehouse_id,
        recipient_code,
        printed_by_user,
        print_type
      )
      VALUES ?
      `,
      [insertValues],
    );

    const [summaryRows] = await connection.query(
      `
      SELECT
        serial_no,
        COUNT(*) AS print_count,

        SUM(
          CASE
            WHEN print_type = 'REPRINT' THEN 1
            ELSE 0
          END
        ) AS reprint_count,

        MAX(created_at) AS last_printed_at

      FROM logs_label_print

      WHERE
        serial_no IN (${placeholders})

      GROUP BY
        serial_no
      `,
      serialNos,
    );

    await connection.commit();

    return res.json({
      success: true,

      message: is_reprint
        ? "บันทึกการ re-print label สำเร็จ"
        : "บันทึกการ print label สำเร็จ",

      printed_count: serialRows.length,

      not_found_count:
        notFoundSerialNos.length,

      not_found_serial_nos:
        notFoundSerialNos,

      data: serialRows,

      summary: summaryRows,
    });
  } catch (error) {
    await connection.rollback();

    console.error(
      "markLabelsPrinted error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถบันทึกการปริ้น label ได้",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

export const getLabelPrintHistory = async (req, res) => {
  try {
    const { serialNo } = req.params;

    const normalizedSerialNo = cleanDbText(
      serialNo,
    );

    if (!normalizedSerialNo) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุ serial_no",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
        lp.id,
        lp.receive_code,
        lp.serial_id,
        lp.serial_no,

        lp.customer_id,
        c.name AS customer_name,

        lp.to_warehouse_id,

        COALESCE(
          NULLIF(wt.warehouse_name_show, ''),
          NULLIF(wt.warehouse_name, ''),
          NULLIF(wt.label_name, ''),
          wt.warehouse_code
        ) AS to_warehouse_name,

        lp.recipient_code,
        lp.printed_by_user,
        lp.print_type,
        lp.created_at

      FROM logs_label_print lp

      LEFT JOIN mm_customers c
        ON c.id = lp.customer_id

      LEFT JOIN mm_warehouses_to wt
        ON wt.warehouse_id = lp.to_warehouse_id

      WHERE
        lp.serial_no = ?

      ORDER BY
        lp.created_at DESC,
        lp.id DESC
      `,
      [normalizedSerialNo],
    );

    const [summaryRows] = await db.query(
      `
      SELECT
        serial_no,
        COUNT(*) AS print_count,

        SUM(
          CASE
            WHEN print_type = 'REPRINT' THEN 1
            ELSE 0
          END
        ) AS reprint_count,

        MAX(created_at) AS last_printed_at

      FROM logs_label_print

      WHERE
        serial_no = ?

      GROUP BY
        serial_no
      `,
      [normalizedSerialNo],
    );

    return res.json({
      success: true,

      summary: summaryRows?.[0] || {
        serial_no: normalizedSerialNo,
        print_count: 0,
        reprint_count: 0,
        last_printed_at: null,
      },

      data: rows,
    });
  } catch (error) {
    console.error(
      "getLabelPrintHistory error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถดึงประวัติการปริ้น label ได้",
      error: error.message,
    });
  }
};

