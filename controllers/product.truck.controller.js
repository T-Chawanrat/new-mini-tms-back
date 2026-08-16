import db from "../config/db.js";
import { toNumberOrNull } from "../utils/cleanText.js";

export const getProductTrucks = async (req, res) => {
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
          product_truck.id AS product_truck_id,
          product_truck.serial_id,
          product_truck.serial_no,
          product_truck.created_by,
          product_truck.user_truck_id,
          product_truck.truck_id,
          product_truck.status AS product_status,
          product_truck.resend_date,
          product_truck.truck_load_id,
          product_truck.created_date,

          receive_serial.receive_code,
          receive_serial.customer_id,
          customer.name AS customer_name,

          truck.truck_code,
          truck.create_date AS truck_create_date,
          truck.driver_type AS driver_type,
          truck.status AS truck_status,
          truck.warehouse_id,
          truck.to_warehouse_id,
          truck.is_close,
          truck.is_go,

          COALESCE(
            NULLIF(product_truck.driver_name, ''),
            NULLIF(TRIM(CONCAT_WS(' ', NULLIF(driver.first_name, ''), NULLIF(driver.last_name, ''))), '')
          ) AS driver_name,
          driver.username AS driver_username,

          COALESCE(vehicle.license_plate, contractor_vehicle.license_plate) AS license_plate,
          COALESCE(vehicle.license_plate_province, contractor_province.province_name) AS license_plate_province,
          COALESCE(vehicle.model, contractor_vehicle.model) AS vehicle_model,

          warehouse_from.warehouse_name AS warehouse_name,
          warehouse_to.warehouse_name AS to_warehouse_name,

          NULLIF(
            TRIM(CONCAT_WS(' ', NULLIF(creator.first_name, ''), NULLIF(creator.last_name, ''))),
            ''
          ) AS created_name
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        LEFT JOIN um_users driver
          ON driver.id = product_truck.user_truck_id
        LEFT JOIN um_users creator
          ON creator.id = product_truck.created_by
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_truck.serial_id
          AND receive_serial.serial_no = product_truck.serial_no
        LEFT JOIN mm_customers customer
          ON customer.id = receive_serial.customer_id
        LEFT JOIN mm_vehicles vehicle
          ON vehicle.id = product_truck.truck_id
        LEFT JOIN mm_vehicles_contractor contractor_vehicle
          ON contractor_vehicle.id = truck.vehicle_contractor_id
        LEFT JOIN mm_province contractor_province
          ON contractor_province.id = contractor_vehicle.license_plate_province_id
        LEFT JOIN mm_warehouses_to warehouse_from
          ON warehouse_from.warehouse_id = truck.warehouse_id
        LEFT JOIN mm_warehouses_to warehouse_to
          ON warehouse_to.warehouse_id = truck.to_warehouse_id
        WHERE COALESCE(truck.is_deleted, 'N') = 'N'
          AND product_truck.status IN ('LOADED', 'DELIVERING')
          AND truck.warehouse_id = ?
        ORDER BY product_truck.created_date DESC, product_truck.id DESC
      `,
      [warehouseId],
    );

    return res.status(200).json({
      success: true,
      data: rows,
      summary: {
        total_items: rows.length,
      },
    });
  } catch (error) {
    console.error("getProductTrucks error:", error);

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถโหลดสินค้าในรถได้",
    });
  }
};
