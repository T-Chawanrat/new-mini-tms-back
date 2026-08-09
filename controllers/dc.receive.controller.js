import db from "../config/db.js";
import { cleanCode, toNumberOrNull } from "../utils/cleanText.js";

const cleanSerialNos = (value) =>
  Array.isArray(value)
    ? [...new Set(value.map((item) => cleanCode(item)).filter(Boolean))]
    : [];

export const getDcReceiveSerials = async (req, res) => {
  try {
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);

    if (!warehouseId) {
      return res.status(400).json({ success: false, message: "ผู้ใช้งานยังไม่ได้กำหนดคลัง DC" });
    }

    const [rows] = await db.query(
      `
        SELECT
          product_truck.serial_id,
          product_truck.serial_no,
          truck.id AS truck_load_id,
          truck.truck_code,
          CASE
            WHEN truck.driver_type = 'CONTRACTOR' THEN truck.driver_name
            ELSE COALESCE(
              NULLIF(CONCAT_WS(' ', NULLIF(driver.first_name, ''), NULLIF(driver.last_name, '')), ''),
              truck.driver_name
            )
          END AS driver_name,
          CASE
            WHEN truck.driver_type = 'CONTRACTOR' THEN truck.license_plate
            ELSE COALESCE(vehicle.license_plate, truck.license_plate)
          END AS license_plate,
          truck.license_plate_province_id,
          COALESCE(plate_province.province_name, vehicle.license_province) AS license_province
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        LEFT JOIN um_users driver
          ON driver.id = truck.user_truck_id
        LEFT JOIN mm_vehicles vehicle
          ON vehicle.id = truck.vehicle_id
        LEFT JOIN mm_province plate_province
          ON plate_province.id = truck.license_plate_province_id
        WHERE truck.to_warehouse_id = ?
          AND truck.is_close = 'Y'
          AND truck.is_go = 'Y'
          AND COALESCE(truck.is_deleted, 'N') = 'N'
          AND product_truck.status IN ('LOADED', 'DELIVERING')
        ORDER BY truck.truck_code ASC, product_truck.id ASC
      `,
      [warehouseId],
    );

    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (error) {
    console.error("getDcReceiveSerials error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดรายการรอรับเข้า DC ได้" });
  }
};

export const createDcReceive = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const serialNos = cleanSerialNos(req.body.serial_nos);
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);
    const actorId = toNumberOrNull(req.user?.id ?? req.user?.user_id);

    if (!serialNos.length || !warehouseId || !actorId) {
      return res.status(400).json({ success: false, message: "ข้อมูลรับสินค้าเข้า DC ไม่ถูกต้อง" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const placeholders = serialNos.map(() => "?").join(", ");
    const [productRows] = await connection.query(
      `
        SELECT
          product_truck.id AS product_truck_id,
          product_truck.serial_id,
          product_truck.serial_no,
          product_warehouse.id AS product_warehouse_id
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        INNER JOIN tm_product_warehouses product_warehouse
          ON product_warehouse.serial_id = product_truck.serial_id
          AND product_warehouse.serial_no = product_truck.serial_no
        WHERE product_truck.serial_no IN (${placeholders})
          AND product_truck.status IN ('LOADED', 'DELIVERING')
          AND truck.to_warehouse_id = ?
          AND truck.is_close = 'Y'
          AND truck.is_go = 'Y'
          AND COALESCE(truck.is_deleted, 'N') = 'N'
        FOR UPDATE
      `,
      [...serialNos, warehouseId],
    );

    const foundSerials = new Set(productRows.map((row) => String(row.serial_no)));
    const missingSerials = serialNos.filter((serialNo) => !foundSerials.has(serialNo));

    if (missingSerials.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: "พบ Serial No ที่ไม่ได้อยู่ในรถซึ่งมาถึง DC นี้",
        not_found_serial_nos: missingSerials,
      });
    }

    await connection.query(
      `
        UPDATE tm_product_warehouses product_warehouse
        INNER JOIN tm_product_trucks product_truck
          ON product_truck.serial_id = product_warehouse.serial_id
          AND product_truck.serial_no = product_warehouse.serial_no
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        SET product_warehouse.now_warehouse_id = ?
        WHERE product_truck.serial_no IN (${placeholders})
          AND truck.to_warehouse_id = ?
      `,
      [warehouseId, ...serialNos, warehouseId],
    );

    await connection.query(
      `
        INSERT INTO logs_product_warehouses (
          product_warehouse_id, serial_id, serial_no, event_type,
          now_warehouse_id, to_warehouse_id, created_by, created_date
        )
        SELECT
          product_warehouse.id,
          product_warehouse.serial_id,
          product_warehouse.serial_no,
          'RECEIVE_DC',
          product_warehouse.now_warehouse_id,
          product_warehouse.to_warehouse_id,
          ?,
          NOW()
        FROM tm_product_warehouses product_warehouse
        WHERE product_warehouse.serial_no IN (${placeholders})
      `,
      [actorId, ...serialNos],
    );

    await connection.query(
      `
        INSERT INTO logs_product_trucks (
          product_truck_id, serial_id, serial_no, event_type, created_by,
          user_truck_id, driver_name, truck_id, truck_license_plate,
          license_plate_province_id, status, truck_load_id, is_dc_mismatch,
          parcel_to_warehouse_id, truck_to_warehouse_id, created_date
        )
        SELECT
          product_truck.id,
          product_truck.serial_id,
          product_truck.serial_no,
          'UNLOAD',
          ?,
          product_truck.user_truck_id,
          COALESCE(product_truck.driver_name, truck.driver_name),
          product_truck.truck_id,
          COALESCE(product_truck.truck_license_plate, truck.license_plate),
          product_truck.license_plate_province_id,
          product_truck.status,
          product_truck.truck_load_id,
          CASE WHEN product_warehouse.to_warehouse_id <> truck.to_warehouse_id THEN 'Y' ELSE 'N' END,
          product_warehouse.to_warehouse_id,
          truck.to_warehouse_id,
          NOW()
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        INNER JOIN tm_product_warehouses product_warehouse
          ON product_warehouse.serial_id = product_truck.serial_id
          AND product_warehouse.serial_no = product_truck.serial_no
        WHERE product_truck.serial_no IN (${placeholders})
          AND truck.to_warehouse_id = ?
          AND product_truck.status IN ('LOADED', 'DELIVERING')
      `,
      [actorId, ...serialNos, warehouseId],
    );

    await connection.query(
      `
        UPDATE tm_truck_details detail
        INNER JOIN tm_product_trucks product_truck
          ON product_truck.truck_load_id = detail.truck_load_id
          AND product_truck.serial_id = detail.serial_id
          AND product_truck.serial_no = detail.serial_no
        SET detail.is_receive = 'Y', detail.receive_by = ?, detail.receive_date = NOW()
        WHERE product_truck.serial_no IN (${placeholders})
          AND product_truck.status IN ('LOADED', 'DELIVERING')
      `,
      [actorId, ...serialNos],
    );

    await connection.query(
      `
        UPDATE tm_product_trucks
        SET status = 'DELIVERED'
        WHERE serial_no IN (${placeholders})
          AND status IN ('LOADED', 'DELIVERING')
      `,
      serialNos,
    );

    await connection.commit();
    transactionStarted = false;
    return res.status(201).json({ success: true, message: "บันทึกรับสินค้าเข้า DC สำเร็จ", received: productRows.length });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    console.error("createDcReceive error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถบันทึกรับสินค้าเข้า DC ได้" });
  } finally {
    connection?.release();
  }
};
