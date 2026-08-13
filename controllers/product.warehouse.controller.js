import db from "../config/db.js";
import { toNumberOrNull } from "../utils/cleanText.js";

export const getProductWarehouses = async (req, res) => {
  try {
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);

    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "ไม่พบคลังของผู้ใช้งาน",
      });
    }

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
          MAX(
            NULLIF(
              TRIM(CONCAT_WS(' ', NULLIF(creator.first_name, ''), NULLIF(creator.last_name, ''))),
              ''
            )
          ) AS created_name,

          COUNT(DISTINCT product_warehouse.serial_no) AS total_items,
          GROUP_CONCAT(
            DISTINCT product_warehouse.serial_no
            ORDER BY product_warehouse.serial_no
            SEPARATOR ', '
          ) AS serial_nos,
          GROUP_CONCAT(
            DISTINCT NULLIF(
              TRIM(CONCAT_WS(' - ', NULLIF(receive_serial.package_name, ''), NULLIF(receive_serial.package_detail_name, ''))),
              ''
            )
            ORDER BY receive_serial.package_name, receive_serial.package_detail_name
            SEPARATOR ', '
          ) AS package_names
        FROM tm_product_warehouses product_warehouse
        INNER JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_warehouse.serial_id
          AND receive_serial.serial_no = product_warehouse.serial_no
        LEFT JOIN mm_customers customer
          ON customer.id = receive_serial.customer_id
        LEFT JOIN um_users creator
          ON creator.id = product_warehouse.created_by
        LEFT JOIN mm_warehouses_to warehouse_now
          ON warehouse_now.warehouse_id = product_warehouse.now_warehouse_id
        LEFT JOIN mm_warehouses_to warehouse_to
          ON warehouse_to.warehouse_id = product_warehouse.to_warehouse_id
        WHERE NULLIF(TRIM(receive_serial.receive_code), '') IS NOT NULL
          AND product_warehouse.now_warehouse_id = ?
        GROUP BY receive_serial.receive_code
        ORDER BY MAX(product_warehouse.id) DESC
      `,
      [warehouseId],
    );

    const [serialRows] = await db.query(
      `
        SELECT
          receive_serial.receive_code,
          product_warehouse.serial_no,
          receive_serial.package_name,
          receive_serial.package_detail_name
        FROM tm_product_warehouses product_warehouse
        INNER JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_warehouse.serial_id
          AND receive_serial.serial_no = product_warehouse.serial_no
        WHERE NULLIF(TRIM(receive_serial.receive_code), '') IS NOT NULL
          AND product_warehouse.now_warehouse_id = ?
        ORDER BY receive_serial.receive_code, product_warehouse.serial_no
      `,
      [warehouseId],
    );

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

    const data = rows.map((row) => ({
      ...row,
      serial_items: Array.from(serialItemsByReceiveCode.get(row.receive_code)?.values() || []),
    }));

    const totalItems = rows.reduce((sum, row) => sum + Number(row.total_items || 0), 0);

    return res.status(200).json({
      success: true,
      data,
      summary: {
        total_bills: rows.length,
        total_items: totalItems,
      },
    });
  } catch (error) {
    console.error("getProductWarehouses error:", error);

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถโหลดสินค้าในคลังได้",
    });
  }
};
