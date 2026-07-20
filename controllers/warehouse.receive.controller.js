import db from "../config/db.js";
import { toNumberOrNull } from "../utils/cleanText.js";

export const getWarehouseReceiveSerials = async (req, res) => {
  try {
    const customerId = toNumberOrNull(req.query.customer_id);
    const toWarehouseId = toNumberOrNull(
      req.query.to_warehouse_id,
    );

    const where = [];
    const params = [];

    if (customerId !== null) {
      where.push("rs.customer_id = ?");
      params.push(customerId);
    }

    if (toWarehouseId !== null) {
      where.push("rs.to_warehouse_id = ?");
      params.push(toWarehouseId);
    }

    const sql = `
      SELECT DISTINCT
        rs.serial_no,
        rs.customer_id,
        c.name AS customer_name,
        rs.to_warehouse_id,
        wt.warehouse_name AS to_warehouse_name
      FROM tm_receive_serials rs
      LEFT JOIN mm_customers c
        ON c.id = rs.customer_id
      LEFT JOIN mm_warehouses_to wt
        ON wt.warehouse_id = rs.to_warehouse_id
      WHERE NULLIF(TRIM(rs.serial_no), '') IS NOT NULL
        ${
          where.length
            ? `AND ${where.join("\n        AND ")}`
            : ""
        }
      ORDER BY
        c.name ASC,
        wt.warehouse_name ASC,
        rs.serial_no ASC
    `;

    const [rows] = await db.query(sql, params);

    return res.status(200).json({
      success: true,
      total: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error(
      "getWarehouseReceiveSerials error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถโหลดข้อมูล Serial No ได้",
      error: error.message,
    });
  }
};