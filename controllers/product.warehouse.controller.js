import db from "../config/db.js";
import { toNumberOrNull } from "../utils/cleanText.js";
import { getPositiveInteger } from "../utils/pagination.js";

export const getProductWarehouses = async (req, res) => {
  try {
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);

    if (!warehouseId) {
      return res.status(400).json({ success: false, message: "ไม่พบคลังของผู้ใช้งาน" });
    }

    const page = getPositiveInteger(req.query.page, 1, Number.MAX_SAFE_INTEGER);
    const limit = getPositiveInteger(req.query.limit, 100, 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim().slice(0, 200);
    const exportAll = req.query.export === "1";
    const searchValue = `%${search}%`;
    const searchConditions = search
      ? `
          AND EXISTS (
            SELECT 1
            FROM tm_product_warehouses matched_product
            INNER JOIN tm_receive_serials matched_receive
              ON matched_receive.serial_id = matched_product.serial_id
              AND matched_receive.serial_no = matched_product.serial_no
            LEFT JOIN mm_customers matched_customer ON matched_customer.id = matched_receive.customer_id
            LEFT JOIN um_users matched_creator ON matched_creator.id = matched_product.created_by
            LEFT JOIN mm_warehouses_to matched_warehouse_now ON matched_warehouse_now.warehouse_id = matched_product.now_warehouse_id
            LEFT JOIN mm_warehouses_to matched_warehouse_to ON matched_warehouse_to.warehouse_id = matched_product.to_warehouse_id
            WHERE matched_product.now_warehouse_id = product_warehouse.now_warehouse_id
              AND matched_receive.receive_code = receive_serial.receive_code
              AND (
                matched_receive.receive_code LIKE ? OR matched_receive.serial_no LIKE ?
                OR matched_receive.package_name LIKE ? OR matched_receive.package_detail_name LIKE ?
                OR CAST(matched_receive.customer_id AS CHAR) LIKE ? OR matched_customer.name LIKE ?
                OR matched_receive.recipient_name LIKE ? OR matched_receive.recipient_code LIKE ?
                OR matched_warehouse_now.warehouse_name LIKE ? OR matched_warehouse_to.warehouse_name LIKE ?
                OR CAST(matched_product.created_by AS CHAR) LIKE ?
                OR CONCAT_WS(' ', matched_creator.first_name, matched_creator.last_name) LIKE ?
              )
          )`
      : "";
    const searchParams = search ? Array(12).fill(searchValue) : [];

    const fromAndWhere = `
      FROM tm_product_warehouses product_warehouse
      INNER JOIN tm_receive_serials receive_serial
        ON receive_serial.serial_id = product_warehouse.serial_id
        AND receive_serial.serial_no = product_warehouse.serial_no
      LEFT JOIN mm_customers customer ON customer.id = receive_serial.customer_id
      LEFT JOIN um_users creator ON creator.id = product_warehouse.created_by
      LEFT JOIN mm_warehouses_to warehouse_now ON warehouse_now.warehouse_id = product_warehouse.now_warehouse_id
      LEFT JOIN mm_warehouses_to warehouse_to ON warehouse_to.warehouse_id = product_warehouse.to_warehouse_id
      LEFT JOIN mm_routes route ON route.route_id = product_warehouse.route_id
      WHERE NULLIF(TRIM(receive_serial.receive_code), '') IS NOT NULL
        AND product_warehouse.now_warehouse_id = ?
        ${searchConditions}
    `;
    const baseParams = [warehouseId, ...searchParams];

    const [summaryRows] = await db.query(
      `
        SELECT COUNT(*) AS total_bills, COALESCE(SUM(grouped.total_items), 0) AS total_items
        FROM (
          SELECT COUNT(DISTINCT product_warehouse.serial_no) AS total_items
          ${fromAndWhere}
          GROUP BY receive_serial.receive_code
        ) grouped
      `,
      baseParams,
    );

    const paginationSql = exportAll ? "" : "LIMIT ? OFFSET ?";
    const paginationParams = exportAll ? [] : [limit, offset];
    const [rows] = await db.query(
      `
        SELECT
          receive_serial.receive_code,
          MAX(receive_serial.delivery_date) AS delivery_date,
          MAX(receive_serial.customer_id) AS customer_id,
          MAX(customer.name) AS customer_name,
          MAX(receive_serial.recipient_id) AS recipient_id,
          MAX(receive_serial.recipient_name) AS recipient_name,
          MAX(receive_serial.recipient_code) AS recipient_code,
          MAX(product_warehouse.now_warehouse_id) AS now_warehouse_id,
          MAX(warehouse_now.warehouse_name) AS now_warehouse_name,
          MAX(product_warehouse.to_warehouse_id) AS to_warehouse_id,
          MAX(warehouse_to.warehouse_name) AS to_warehouse_name,
          MAX(product_warehouse.created_by) AS created_by,
          MAX(NULLIF(TRIM(CONCAT_WS(' ', NULLIF(creator.first_name, ''), NULLIF(creator.last_name, ''))), '')) AS created_name,
          GROUP_CONCAT(DISTINCT NULLIF(TRIM(route.route_name), '') ORDER BY route.route_name SEPARATOR ', ') AS route_name,
          COUNT(DISTINCT product_warehouse.serial_no) AS total_items,
          GROUP_CONCAT(DISTINCT product_warehouse.serial_no ORDER BY product_warehouse.serial_no SEPARATOR ', ') AS serial_nos,
          GROUP_CONCAT(
            DISTINCT NULLIF(TRIM(CONCAT_WS(' - ', NULLIF(receive_serial.package_name, ''), NULLIF(receive_serial.package_detail_name, ''))), '')
            ORDER BY receive_serial.package_name, receive_serial.package_detail_name SEPARATOR ', '
          ) AS package_names
        ${fromAndWhere}
        GROUP BY receive_serial.receive_code
        ORDER BY MAX(product_warehouse.id) DESC
        ${paginationSql}
      `,
      [...baseParams, ...paginationParams],
    );

    const receiveCodes = rows.map((row) => row.receive_code).filter(Boolean);
    let serialRows = [];

    if (receiveCodes.length) {
      const placeholders = receiveCodes.map(() => "?").join(", ");
      [serialRows] = await db.query(
        `
          SELECT receive_serial.receive_code, product_warehouse.serial_no,
            receive_serial.package_name, receive_serial.package_detail_name
          FROM tm_product_warehouses product_warehouse
          INNER JOIN tm_receive_serials receive_serial
            ON receive_serial.serial_id = product_warehouse.serial_id
            AND receive_serial.serial_no = product_warehouse.serial_no
          WHERE product_warehouse.now_warehouse_id = ?
            AND receive_serial.receive_code IN (${placeholders})
          ORDER BY receive_serial.receive_code, product_warehouse.serial_no
        `,
        [warehouseId, ...receiveCodes],
      );
    }

    const serialItemsByReceiveCode = new Map();
    serialRows.forEach((row) => {
      const items = serialItemsByReceiveCode.get(row.receive_code) || new Map();
      items.set(row.serial_no, {
        serial_no: row.serial_no,
        package_name: row.package_name,
        package_detail_name: row.package_detail_name,
      });
      serialItemsByReceiveCode.set(row.receive_code, items);
    });

    const summary = summaryRows[0] || {};
    return res.status(200).json({
      success: true,
      data: rows.map((row) => ({
        ...row,
        serial_items: Array.from(serialItemsByReceiveCode.get(row.receive_code)?.values() || []),
      })),
      summary: {
        total_bills: Number(summary.total_bills || 0),
        total_items: Number(summary.total_items || 0),
      },
      pagination: { page, limit },
    });
  } catch (error) {
    console.error("getProductWarehouses error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดสินค้าในคลังได้" });
  }
};
