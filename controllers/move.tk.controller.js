import db from "../config/db.js";
import { cleanCode, toNumberOrNull } from "../utils/cleanText.js";

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
  CASE
    WHEN truck.driver_type = 'CONTRACTOR' THEN truck.license_plate
    ELSE COALESCE(vehicle.license_plate, truck.license_plate)
  END AS license_plate,
  truck.license_plate_province_id,
  COALESCE(plate_province.province_name, vehicle.license_province) AS license_province,
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
  LEFT JOIN mm_province plate_province
    ON plate_province.id = truck.license_plate_province_id
`;

const syncTruckCount = async (connection, truckLoadId) => {
  const [countRows] = await connection.query(
    `SELECT COUNT(*) AS count_box FROM tm_truck_details WHERE truck_load_id = ?`,
    [truckLoadId],
  );
  const countBox = Number(countRows[0]?.count_box || 0);

  const [existingRows] = await connection.query(
    `SELECT id FROM tm_truck_count WHERE truck_load_id = ? LIMIT 1`,
    [truckLoadId],
  );

  if (existingRows.length) {
    await connection.query(
      `UPDATE tm_truck_count SET count_box = ? WHERE id = ?`,
      [countBox, existingRows[0].id],
    );
    return;
  }

  await connection.query(
    `INSERT INTO tm_truck_count (truck_load_id, count_box) VALUES (?, ?)`,
    [truckLoadId, countBox],
  );
};

export const getMoveTkSourceTrucks = async (_req, res) => {
  try {
    const [rows] = await db.query(
      `
        SELECT ${TRUCK_LIST_SELECT}
        ${TRUCK_LIST_JOINS}
        WHERE truck.is_close = 'Y'
          AND COALESCE(truck.is_deleted, 'N') = 'N'
        ORDER BY truck.create_date DESC, truck.id DESC
      `,
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
    const params = [];
    const sourceCondition = sourceTruckLoadId ? "AND truck.id <> ?" : "";

    if (sourceTruckLoadId) params.push(sourceTruckLoadId);

    const [rows] = await db.query(
      `
        SELECT ${TRUCK_LIST_SELECT}
        ${TRUCK_LIST_JOINS}
        WHERE COALESCE(truck.is_deleted, 'N') = 'N'
          ${sourceCondition}
        ORDER BY truck.create_date DESC, truck.id DESC
      `,
      params,
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

    if (!truckLoadId) {
      return res.status(400).json({ success: false, message: "truck_load_id ไม่ถูกต้อง" });
    }

    const [rows] = await db.query(
      `
        SELECT
          product_truck.id AS product_truck_id,
          product_truck.serial_id,
          product_truck.serial_no,
          truck.driver_type,
          CASE
            WHEN truck.driver_type = 'CONTRACTOR' THEN truck.license_plate
            ELSE COALESCE(vehicle.license_plate, truck.license_plate)
          END AS license_plate,
          truck.license_plate_province_id,
          product_warehouse.to_warehouse_id,
          destination.warehouse_name AS to_warehouse_name
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        LEFT JOIN mm_vehicles vehicle
          ON vehicle.id = truck.vehicle_id
        LEFT JOIN tm_product_warehouses product_warehouse
          ON product_warehouse.id = (
            SELECT MAX(latest_warehouse.id)
            FROM tm_product_warehouses latest_warehouse
            WHERE latest_warehouse.serial_id = product_truck.serial_id
              AND latest_warehouse.serial_no = product_truck.serial_no
          )
        LEFT JOIN mm_warehouses_to destination
          ON destination.warehouse_id = product_warehouse.to_warehouse_id
        WHERE product_truck.truck_load_id = ?
          AND truck.is_close = 'Y'
          AND COALESCE(truck.is_deleted, 'N') = 'N'
          AND product_truck.status IN ('PENDING', 'LOADED', 'DELIVERING')
        ORDER BY product_truck.id ASC
      `,
      [truckLoadId],
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
    const serialNos = Array.isArray(req.body.serial_nos)
      ? [...new Set(req.body.serial_nos.map((value) => cleanCode(value)).filter(Boolean))]
      : [];

    if (!sourceTruckLoadId || !targetTruckLoadId || sourceTruckLoadId === targetTruckLoadId || !serialNos.length || !actorId) {
      return res.status(400).json({ success: false, message: "ข้อมูลการย้ายใบปิดบรรทุกไม่ถูกต้อง" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [truckRows] = await connection.query(
      `
        SELECT id, is_close
        FROM tm_trucks
        WHERE id IN (?, ?)
          AND COALESCE(is_deleted, 'N') = 'N'
        FOR UPDATE
      `,
      [sourceTruckLoadId, targetTruckLoadId],
    );

    const sourceTruck = truckRows.find((row) => Number(row.id) === sourceTruckLoadId);
    const targetTruck = truckRows.find((row) => Number(row.id) === targetTruckLoadId);

    if (!sourceTruck || !targetTruck || sourceTruck.is_close !== "Y") {
      await connection.rollback();
      transactionStarted = false;
      return res.status(400).json({ success: false, message: "ไม่พบใบต้นทาง/ปลายทาง หรือใบต้นทางยังไม่ปิดบรรทุก" });
    }

    const placeholders = serialNos.map(() => "?").join(", ");
    const [productRows] = await connection.query(
      `
        SELECT id, serial_no
        FROM tm_product_trucks
        WHERE truck_load_id = ?
          AND serial_no IN (${placeholders})
          AND status IN ('PENDING', 'LOADED', 'DELIVERING')
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

    const [result] = await connection.query(
      `
        UPDATE tm_product_trucks
        SET truck_load_id = ?
        WHERE truck_load_id = ?
          AND serial_no IN (${placeholders})
          AND status IN ('PENDING', 'LOADED', 'DELIVERING')
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
          CASE
            WHEN target_truck.driver_type = 'CONTRACTOR' THEN target_truck.license_plate
            ELSE COALESCE(vehicle.license_plate, target_truck.license_plate)
          END,
          target_truck.license_plate_province_id,
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
          NOW()
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
      [actorId, targetTruckLoadId, ...serialNos],
    );

    await syncTruckCount(connection, sourceTruckLoadId);
    await syncTruckCount(connection, targetTruckLoadId);

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
