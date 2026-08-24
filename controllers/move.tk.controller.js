import db from "../config/db.js";
import { cleanCode, toNumberOrNull } from "../utils/cleanText.js";
import { syncTruckBoxCount } from "../utils/truckUtils.js";

const TRUCK_LIST_SELECT = `
  truck.id AS truck_load_id,
  truck.truck_code,
  truck.is_close,
  truck.is_go,
  truck.to_warehouse_id,
  truck.driver_type,
  CASE
    WHEN truck.driver_type = 'CONTRACTOR' THEN truck.driver_name
    ELSE COALESCE(
      NULLIF(CONCAT_WS(' ', NULLIF(driver.first_name, ''), NULLIF(driver.last_name, '')), ''),
      truck.driver_name
    )
  END AS driver_name,
  COALESCE(vehicle.license_plate, contractor_vehicle.license_plate) AS license_plate,
  COALESCE(vehicle.license_plate_province_id, contractor_vehicle.license_plate_province_id) AS license_plate_province_id,
  COALESCE(vehicle.license_plate_province, contractor_province.province_name) AS license_province,
  (SELECT COUNT(*) FROM tm_truck_details detail WHERE detail.truck_load_id = truck.id) AS count_box,
  warehouse_from.warehouse_name AS warehouse_name,
  warehouse_to.warehouse_name AS to_warehouse_name
`;

const TRUCK_LIST_JOINS = `
  FROM tm_trucks truck
  LEFT JOIN mm_warehouses_to warehouse_from
    ON warehouse_from.warehouse_id = truck.warehouse_id
  LEFT JOIN mm_warehouses_to warehouse_to
    ON warehouse_to.warehouse_id = truck.to_warehouse_id
  LEFT JOIN um_users driver
    ON driver.id = truck.user_truck_id
  LEFT JOIN mm_vehicles vehicle
    ON vehicle.id = truck.vehicle_id
  LEFT JOIN mm_vehicles_contractor contractor_vehicle
    ON contractor_vehicle.id = truck.vehicle_contractor_id
  LEFT JOIN mm_province contractor_province
    ON contractor_province.id = contractor_vehicle.license_plate_province_id
`;

export const getMoveTkSourceTrucks = async (req, res) => {
  try {
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);

    if (!warehouseId) {
      return res.status(401).json({ success: false, message: "ไม่พบ Warehouse ที่เลือก" });
    }

    const [rows] = await db.query(
      `
        SELECT ${TRUCK_LIST_SELECT}
        ${TRUCK_LIST_JOINS}
        WHERE truck.is_close = 'Y'
          AND COALESCE(truck.is_deleted, 'N') = 'N'
          AND COALESCE(truck.is_arrived, 'N') <> 'Y'
          AND truck.warehouse_id = ?
        ORDER BY truck.create_date DESC, truck.id DESC
      `,
      [warehouseId],
    );

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("getMoveTkSourceTrucks error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดใบปิดบรรทุกต้นทางได้" });
  }
};

export const getMoveTkTargetTrucks = async (req, res) => {
  try {
    const sourceTruckLoadId = toNumberOrNull(req.query.source_truck_load_id);
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);

    if (!warehouseId) {
      return res.status(401).json({ success: false, message: "ไม่พบ Warehouse ที่เลือก" });
    }

    if (!sourceTruckLoadId) {
      return res.status(200).json({ success: true, data: [] });
    }

    const [rows] = await db.query(
      `
        SELECT ${TRUCK_LIST_SELECT}
        ${TRUCK_LIST_JOINS}
        INNER JOIN tm_trucks source_truck
          ON source_truck.id = ?
          AND COALESCE(source_truck.is_deleted, 'N') = 'N'
          AND COALESCE(source_truck.is_arrived, 'N') <> 'Y'
          AND source_truck.warehouse_id = ?
        WHERE COALESCE(truck.is_deleted, 'N') = 'N'
          AND COALESCE(truck.is_arrived, 'N') <> 'Y'
          AND truck.id <> source_truck.id
          AND truck.warehouse_id = source_truck.warehouse_id
          AND truck.status = 'DC_TRUCK_DC'
        ORDER BY truck.create_date DESC, truck.id DESC
      `,
      [sourceTruckLoadId, warehouseId],
    );

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("getMoveTkTargetTrucks error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดใบปิดบรรทุกปลายทางได้" });
  }
};

export const getMoveTkProducts = async (req, res) => {
  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);

    if (!truckLoadId || !warehouseId) {
      return res.status(400).json({ success: false, message: "truck_load_id ไม่ถูกต้อง" });
    }

    const [rows] = await db.query(
      `
        SELECT
          product_truck.id AS product_truck_id,
          product_truck.serial_id,
          product_truck.serial_no,
          truck.driver_type,
          COALESCE(vehicle.license_plate, contractor_vehicle.license_plate) AS license_plate,
          COALESCE(vehicle.license_plate_province_id, contractor_vehicle.license_plate_province_id) AS license_plate_province_id,
          COALESCE(vehicle.license_plate_province, contractor_province.province_name) AS license_province,
          COALESCE(product_warehouse.to_warehouse_id, receive_serial.to_warehouse_id) AS to_warehouse_id,
          destination.warehouse_name AS to_warehouse_name
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        LEFT JOIN mm_vehicles vehicle
          ON vehicle.id = product_truck.truck_id
        LEFT JOIN mm_vehicles_contractor contractor_vehicle
          ON contractor_vehicle.id = truck.vehicle_contractor_id
        LEFT JOIN mm_province contractor_province
          ON contractor_province.id = contractor_vehicle.license_plate_province_id
        LEFT JOIN tm_product_warehouses product_warehouse
          ON product_warehouse.id = (
            SELECT MAX(latest_warehouse.id)
            FROM tm_product_warehouses latest_warehouse
            WHERE latest_warehouse.serial_id = product_truck.serial_id
              AND latest_warehouse.serial_no = product_truck.serial_no
          )
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_truck.serial_id
          AND receive_serial.serial_no = product_truck.serial_no
        LEFT JOIN mm_warehouses_to destination
          ON destination.warehouse_id = COALESCE(product_warehouse.to_warehouse_id, receive_serial.to_warehouse_id)
        WHERE product_truck.truck_load_id = ?
          AND truck.is_close = 'Y'
          AND COALESCE(truck.is_deleted, 'N') = 'N'
          AND COALESCE(truck.is_arrived, 'N') <> 'Y'
          AND truck.warehouse_id = ?
          AND product_truck.status IN ('LOADED', 'DELIVERING')
        ORDER BY product_truck.id ASC
      `,
      [truckLoadId, warehouseId],
    );

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("getMoveTkProducts error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดสินค้าในใบปิดบรรทุกได้" });
  }
};

export const moveTkProducts = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const sourceTruckLoadId = toNumberOrNull(req.body.source_truck_load_id);
    const targetTruckLoadId = toNumberOrNull(req.body.target_truck_load_id);
    const actorId = toNumberOrNull(req.user?.id ?? req.user?.user_id);
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);
    const serialNos = Array.isArray(req.body.serial_nos)
      ? [...new Set(req.body.serial_nos.map((value) => cleanCode(value)).filter(Boolean))]
      : [];
    const confirmedMismatchSerialNos = new Set(
      Array.isArray(req.body.confirmed_destination_mismatch_serial_nos)
        ? req.body.confirmed_destination_mismatch_serial_nos.map((value) => cleanCode(value)).filter(Boolean)
        : [],
    );

    if (!sourceTruckLoadId || !targetTruckLoadId || sourceTruckLoadId === targetTruckLoadId || !serialNos.length || !actorId || !warehouseId) {
      return res.status(400).json({ success: false, message: "ข้อมูลการย้ายใบปิดบรรทุกไม่ถูกต้อง" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const now = new Date();

    const [truckRows] = await connection.query(
      `
        SELECT id, is_close, to_warehouse_id, warehouse_id, status
        FROM tm_trucks
        WHERE id IN (?, ?)
          AND COALESCE(is_deleted, 'N') = 'N'
          AND COALESCE(is_arrived, 'N') <> 'Y'
        FOR UPDATE
      `,
      [sourceTruckLoadId, targetTruckLoadId],
    );

    const sourceTruck = truckRows.find((row) => Number(row.id) === sourceTruckLoadId);
    const targetTruck = truckRows.find((row) => Number(row.id) === targetTruckLoadId);

    if (!sourceTruck || !targetTruck || sourceTruck.is_close !== "Y" || targetTruck.status !== "DC_TRUCK_DC") {
      await connection.rollback();
      transactionStarted = false;
      return res.status(400).json({ success: false, message: "ไม่พบใบต้นทาง/ปลายทาง หรือใบต้นทางยังไม่ปิดบรรทุก" });
    }

    if (Number(sourceTruck.warehouse_id) !== Number(targetTruck.warehouse_id)) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(400).json({ success: false, message: "ใบปลายทางต้องอยู่ DC ต้นทางเดียวกับใบต้นทาง" });
    }

    if (Number(sourceTruck.warehouse_id) !== warehouseId) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(403).json({ success: false, message: "คุณไม่มีสิทธิ์ย้ายสินค้าใน DC นี้" });
    }

    const placeholders = serialNos.map(() => "?").join(", ");
    const [productRows] = await connection.query(
      `
        SELECT
          product_truck.id,
          product_truck.serial_no,
          COALESCE(product_warehouse.to_warehouse_id, receive_serial.to_warehouse_id) AS to_warehouse_id
        FROM tm_product_trucks product_truck
        LEFT JOIN tm_product_warehouses product_warehouse
          ON product_warehouse.id = (
            SELECT MAX(latest_warehouse.id)
            FROM tm_product_warehouses latest_warehouse
            WHERE latest_warehouse.serial_id = product_truck.serial_id
              AND latest_warehouse.serial_no = product_truck.serial_no
          )
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_truck.serial_id
          AND receive_serial.serial_no = product_truck.serial_no
        WHERE product_truck.truck_load_id = ?
          AND product_truck.serial_no IN (${placeholders})
          AND product_truck.status IN ('LOADED', 'DELIVERING')
        FOR UPDATE
      `,
      [sourceTruckLoadId, ...serialNos],
    );

    const foundSerials = new Set(productRows.map((row) => String(row.serial_no)));
    const missingSerials = serialNos.filter((serialNo) => !foundSerials.has(serialNo));

    if (missingSerials.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: "พบ Serial No ที่ไม่ได้อยู่ในใบปิดบรรทุกต้นทาง",
        not_found_serial_nos: missingSerials,
      });
    }

    const unconfirmedMismatches = productRows.filter(
      (row) =>
        row.to_warehouse_id !== null &&
        targetTruck.to_warehouse_id !== null &&
        Number(row.to_warehouse_id) !== Number(targetTruck.to_warehouse_id) &&
        !confirmedMismatchSerialNos.has(String(row.serial_no)),
    );

    if (unconfirmedMismatches.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({
        success: false,
        message: "มีพัสดุที่ปลายทางไม่ตรงกับใบปิดบรรทุกปลายทาง",
        destination_mismatch_serial_nos: unconfirmedMismatches.map((row) => row.serial_no),
      });
    }

    const [result] = await connection.query(
      `
        UPDATE tm_product_trucks product_truck
        INNER JOIN tm_trucks target_truck
          ON target_truck.id = ?
        SET
          product_truck.truck_load_id = target_truck.id,
          product_truck.user_truck_id = target_truck.user_truck_id,
          product_truck.driver_name = target_truck.driver_name,
          product_truck.truck_id = target_truck.vehicle_id,
          product_truck.status = CASE
            WHEN target_truck.is_go = 'Y' THEN 'DELIVERING'
            ELSE 'LOADED'
          END
        WHERE product_truck.truck_load_id = ?
          AND product_truck.serial_no IN (${placeholders})
          AND product_truck.status IN ('LOADED', 'DELIVERING')
      `,
      [targetTruckLoadId, sourceTruckLoadId, ...serialNos],
    );

    await connection.query(
      `
        UPDATE tm_truck_details
        SET truck_load_id = ?
        WHERE truck_load_id = ?
          AND serial_no IN (${placeholders})
      `,
      [targetTruckLoadId, sourceTruckLoadId, ...serialNos],
    );

    await connection.query(
      `
        INSERT INTO logs_product_trucks (
          product_truck_id,
          serial_id,
          serial_no,
          event_type,
          created_by,
          user_truck_id,
          driver_name,
          truck_id,
          truck_license_plate,
          license_plate_province_id,
          status,
          truck_load_id,
          is_dc_mismatch,
          parcel_to_warehouse_id,
          truck_to_warehouse_id,
          created_date
        )
        SELECT
          product_truck.id,
          product_truck.serial_id,
          product_truck.serial_no,
          'MOVE',
          ?,
          target_truck.user_truck_id,
          CASE
            WHEN target_truck.driver_type = 'CONTRACTOR' THEN target_truck.driver_name
            ELSE COALESCE(
              NULLIF(CONCAT_WS(' ', NULLIF(driver.first_name, ''), NULLIF(driver.last_name, '')), ''),
              target_truck.driver_name
            )
          END,
          target_truck.vehicle_id,
          vehicle.license_plate,
          vehicle.license_plate_province_id,
          product_truck.status,
          product_truck.truck_load_id,
          CASE
            WHEN product_warehouse.to_warehouse_id IS NOT NULL
              AND target_truck.to_warehouse_id IS NOT NULL
              AND product_warehouse.to_warehouse_id <> target_truck.to_warehouse_id
            THEN 'Y'
            ELSE 'N'
          END,
          product_warehouse.to_warehouse_id,
          target_truck.to_warehouse_id,
          ?
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks target_truck
          ON target_truck.id = product_truck.truck_load_id
        LEFT JOIN um_users driver
          ON driver.id = target_truck.user_truck_id
        LEFT JOIN mm_vehicles vehicle
          ON vehicle.id = target_truck.vehicle_id
        LEFT JOIN tm_product_warehouses product_warehouse
          ON product_warehouse.id = (
            SELECT MAX(latest_warehouse.id)
            FROM tm_product_warehouses latest_warehouse
            WHERE latest_warehouse.serial_id = product_truck.serial_id
              AND latest_warehouse.serial_no = product_truck.serial_no
          )
        WHERE product_truck.truck_load_id = ?
          AND product_truck.serial_no IN (${placeholders})
      `,
      [actorId, now, targetTruckLoadId, ...serialNos],
    );

    await syncTruckBoxCount(connection, sourceTruckLoadId);
    await syncTruckBoxCount(connection, targetTruckLoadId);

    const [sourceCountRows] = await connection.query(
      `SELECT COUNT(*) AS count_box FROM tm_truck_details WHERE truck_load_id = ?`,
      [sourceTruckLoadId],
    );
    const sourceIsEmpty = Number(sourceCountRows[0]?.count_box || 0) === 0;

    if (sourceIsEmpty) {
      await connection.query(
        `
          UPDATE tm_trucks
          SET
            is_deleted = 'Y',
            deleted_by = ?
          WHERE id = ?
            AND COALESCE(is_deleted, 'N') = 'N'
        `,
        [actorId, sourceTruckLoadId],
      );
    }

    await connection.commit();
    transactionStarted = false;

    return res.status(200).json({
      success: true,
      message: sourceIsEmpty
        ? "ย้ายสินค้าสำเร็จ และลบใบปิดบรรทุกต้นทางที่ไม่มีสินค้าแล้ว"
        : "ย้ายสินค้าไปยังใบปิดบรรทุกใหม่สำเร็จ",
      moved: result.affectedRows,
      source_deleted: sourceIsEmpty,
    });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    console.error("moveTkProducts error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถย้ายสินค้าไปยังใบปิดบรรทุกใหม่ได้" });
  } finally {
    connection?.release();
  }
};
