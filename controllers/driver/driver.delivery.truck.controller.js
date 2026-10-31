import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import db from "../../config/db.js";
import { toNumberOrNull } from "../../utils/input.js";
import { buildTruckVehicleSql } from "../../utils/truck.js";
import { parseLocation } from "../../utils/location.js";
import {
  createDriverDeliveryTruck as createTruck,
  getDeliveryTruckProducts as getTruckProducts,
  getDriverDeliveryTruckOptions as getTruckOptions,
  loadDeliveryTruckProduct as loadTruckProduct,
  unloadDeliveryTruckProduct as unloadTruckProduct,
} from "./driver.delivery.truck.operations.controller.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDirectory = path.resolve(__dirname, "../../uploads");
const truckVehicleSql = buildTruckVehicleSql();

const getActorId = (req) => toNumberOrNull(req.user?.id ?? req.user?.user_id);
const getWarehouseId = (req) => toNumberOrNull(req.user?.warehouse_id);

const withOwnedDeliveryTruck = (handler) => async (req, res, next) => {
  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const actorId = getActorId(req);
    const warehouseId = getWarehouseId(req);
    if (!truckLoadId || !actorId || !warehouseId) {
      return res.status(400).json({ success: false, message: "ข้อมูลใบรถกระจายไม่ถูกต้อง" });
    }

    const [[truck]] = await db.query(
      `SELECT id FROM tm_trucks WHERE id = ? AND status = 'DC_TRUCK' AND warehouse_id = ? AND user_truck_id = ? AND COALESCE(is_deleted, 'N') = 'N' LIMIT 1`,
      [truckLoadId, warehouseId, actorId],
    );
    if (!truck) return res.status(404).json({ success: false, message: "ไม่พบใบรถกระจายของคุณ" });
    return handler(req, res, next);
  } catch (error) {
    console.error("withOwnedDeliveryTruck error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถตรวจสอบใบรถกระจายได้" });
  }
};

// Check ownership before applying the driver-specific truck operations.
export const getDriverDeliveryTruckOptions = getTruckOptions;
export const createDriverDeliveryTruck = createTruck;
export const getDriverDeliveryTruckProducts = withOwnedDeliveryTruck(getTruckProducts);
export const loadDriverDeliveryTruckProduct = withOwnedDeliveryTruck(loadTruckProduct);
export const unloadDriverDeliveryTruckProduct = withOwnedDeliveryTruck(unloadTruckProduct);

const createClosedDeliveryTruckCode = async (connection, dateCode) => {
  const codePrefix = `DT-${dateCode}-`;
  const lockName = `delivery_truck_code_${dateCode}`;
  let hasLock = false;

  try {
    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 10) AS lock_acquired", [lockName]);

    if (Number(lockRow.lock_acquired) !== 1) {
      throw new Error("unable to reserve delivery truck code running number");
    }

    hasLock = true;

    const [[runningRow]] = await connection.query(
      `
        SELECT COALESCE(MAX(CAST(RIGHT(truck_code, 4) AS UNSIGNED)), 0) AS last_no
        FROM tm_trucks
        WHERE truck_code LIKE ?
          AND CHAR_LENGTH(truck_code) = 14
      `,
      [`${codePrefix}%`],
    );
    const nextRunning = Number(runningRow.last_no) + 1;

    if (nextRunning > 9999) {
      throw new Error("delivery truck code running number is exhausted for today");
    }

    return `${codePrefix}${String(nextRunning).padStart(4, "0")}`;
  } finally {
    if (hasLock) {
      await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
    }
  }
};

const writeDeliveryTruckTransactions = async ({ connection, truckLoadId, actorId, statusId, statusMessage, now, dataYear, dataYearmonth }) => {
  await connection.query(
    `
      INSERT INTO tm_product_transactions (
        receive_business_id, receive_walkin_id, receive_code, serial_id, serial_no,
        status_message, status_id, datetime, update_date, type,
        warehouse_id, created_by, latitude, longitude, warehouse_name,
        address, province_name, district_name, subdistrict_name, zip_code,
        created_name, username, truck_license_plate, user_id, user_truck_id,
        truck_name, truck_id, vehicle_contractor_id, truck_province, note,
        data_year, data_yearmonth
      )
      SELECT
        transaction_last.receive_business_id,
        transaction_last.receive_walkin_id,
        transaction_last.receive_code,
        transaction_last.serial_id,
        transaction_last.serial_no,
        ?, ?, ?, NULL, NULL,
        truck.warehouse_id, actor.id, transaction_last.latitude, transaction_last.longitude, warehouse.warehouse_name,
        transaction_last.address, transaction_last.province_name, transaction_last.district_name, transaction_last.subdistrict_name, transaction_last.zip_code,
        TRIM(CONCAT_WS(' ', NULLIF(actor.first_name, ''), NULLIF(actor.last_name, ''))),
        actor.username,
        ${truckVehicleSql.licensePlate},
        truck.user_truck_id,
        truck.user_truck_id,
        truck.truck_code,
        truck.vehicle_id,
        truck.vehicle_contractor_id,
        COALESCE(plate_province.province_name, contractor_plate_province.province_name),
        transaction_last.note,
        ?, ?
      FROM tm_product_transactions_last transaction_last
      INNER JOIN tm_product_trucks product_truck
        ON product_truck.serial_id = transaction_last.serial_id
        AND product_truck.serial_no = transaction_last.serial_no
      INNER JOIN tm_product_actived product_active
        ON product_active.serial_id = product_truck.serial_id
        AND product_active.serial_no = product_truck.serial_no
      INNER JOIN tm_trucks truck
        ON truck.id = product_truck.truck_load_id
      INNER JOIN um_users actor
        ON actor.id = ?
      LEFT JOIN mm_warehouses_to warehouse
        ON warehouse.warehouse_id = truck.warehouse_id
      LEFT JOIN mm_vehicles vehicle
        ON vehicle.id = product_truck.truck_id
      LEFT JOIN mm_vehicles_contractor contractor_vehicle
        ON contractor_vehicle.id = truck.vehicle_contractor_id
      LEFT JOIN mm_province plate_province
        ON plate_province.id = vehicle.license_plate_province_id
      LEFT JOIN mm_province contractor_plate_province
        ON contractor_plate_province.id = contractor_vehicle.license_plate_province_id
      WHERE product_truck.truck_load_id = ?
    `,
    [statusMessage, statusId, now, dataYear, dataYearmonth, actorId, truckLoadId],
  );

  await connection.query(
    `
      UPDATE tm_product_transactions_last transaction_last
      INNER JOIN tm_product_trucks product_truck
        ON product_truck.serial_id = transaction_last.serial_id
        AND product_truck.serial_no = transaction_last.serial_no
      INNER JOIN tm_product_actived product_active
        ON product_active.serial_id = product_truck.serial_id
        AND product_active.serial_no = product_truck.serial_no
      INNER JOIN tm_trucks truck
        ON truck.id = product_truck.truck_load_id
      INNER JOIN um_users actor
        ON actor.id = ?
      LEFT JOIN mm_warehouses_to warehouse
        ON warehouse.warehouse_id = truck.warehouse_id
      LEFT JOIN mm_vehicles vehicle
        ON vehicle.id = product_truck.truck_id
      LEFT JOIN mm_vehicles_contractor contractor_vehicle
        ON contractor_vehicle.id = truck.vehicle_contractor_id
      LEFT JOIN mm_province plate_province
        ON plate_province.id = vehicle.license_plate_province_id
      LEFT JOIN mm_province contractor_plate_province
        ON contractor_plate_province.id = contractor_vehicle.license_plate_province_id
      SET
        transaction_last.status_message = ?,
        transaction_last.status_id = ?,
        transaction_last.datetime = ?,
        transaction_last.update_date = ?,
        transaction_last.type = NULL,
        transaction_last.warehouse_id = truck.warehouse_id,
        transaction_last.created_by = actor.id,
        transaction_last.warehouse_name = warehouse.warehouse_name,
        transaction_last.created_name = TRIM(CONCAT_WS(' ', NULLIF(actor.first_name, ''), NULLIF(actor.last_name, ''))),
        transaction_last.username = actor.username,
        transaction_last.truck_license_plate = ${truckVehicleSql.licensePlate},
        transaction_last.user_id = truck.user_truck_id,
        transaction_last.user_truck_id = truck.user_truck_id,
        transaction_last.truck_name = truck.truck_code,
        transaction_last.truck_id = truck.vehicle_id,
        transaction_last.vehicle_contractor_id = truck.vehicle_contractor_id,
        transaction_last.truck_province = COALESCE(plate_province.province_name, contractor_plate_province.province_name)
      WHERE product_truck.truck_load_id = ?
    `,
    [actorId, statusMessage, statusId, now, now, truckLoadId],
  );
};

export const getDriverDeliveryTruck = async (req, res) => {
  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const actorId = getActorId(req);
    const warehouseId = getWarehouseId(req);

    if (!truckLoadId || !actorId || !warehouseId) {
      return res.status(400).json({ success: false, message: "ข้อมูลใบรถกระจายไม่ถูกต้อง" });
    }

    const [[truck]] = await db.query(
      `
        SELECT
          truck.id AS truck_load_id,
          truck.truck_code,
          truck.is_close,
          truck.is_go,
          route.route_code,
          route.route_name,
          ${truckVehicleSql.licensePlate} AS license_plate,
          ${truckVehicleSql.licenseProvince} AS license_plate_province
        FROM tm_trucks truck
        LEFT JOIN mm_vehicles vehicle ON vehicle.id = truck.vehicle_id
        LEFT JOIN mm_vehicles_contractor contractor_vehicle ON contractor_vehicle.id = truck.vehicle_contractor_id
        LEFT JOIN mm_province contractor_province ON contractor_province.id = contractor_vehicle.license_plate_province_id
        LEFT JOIN mm_routes route ON route.route_id = truck.route_id
        WHERE truck.id = ?
          AND truck.status = 'DC_TRUCK'
          AND truck.warehouse_id = ?
          AND truck.user_truck_id = ?
          AND COALESCE(truck.is_deleted, 'N') = 'N'
        LIMIT 1
      `,
      [truckLoadId, warehouseId, actorId],
    );

    if (!truck) {
      return res.status(404).json({ success: false, message: "ไม่พบใบรถกระจายของคุณ" });
    }

    return res.json({ success: true, data: truck });
  } catch (error) {
    console.error("getDriverDeliveryTruck error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดข้อมูลใบรถกระจายได้" });
  }
};

export const closeAndGoDriverDeliveryTruck = async (req, res) => {
  let connection;
  let transactionStarted = false;
  const createdFiles = [];

  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const actorId = getActorId(req);
    const warehouseId = getWarehouseId(req);
    const photo = req.file;
    const { latitude, longitude, accuracy: accuracyM } = parseLocation({
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      accuracy: req.body.accuracy_m,
    });

    if (!truckLoadId || !actorId || !warehouseId) {
      return res.status(400).json({ success: false, message: "ข้อมูลใบรถกระจายไม่ถูกต้อง" });
    }

    if (!photo?.storedName) {
      return res.status(400).json({ success: false, message: "กรุณาถ่ายรูปปิดบรรทุก" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [truckRows] = await connection.query(
      `
        SELECT
          truck.id,
          truck.is_close,
          truck.is_go,
          COALESCE(truck_count.count_box, 0) AS serial_count
        FROM tm_trucks truck
        LEFT JOIN tm_truck_count truck_count
          ON truck_count.truck_load_id = truck.id
        WHERE truck.id = ?
          AND truck.status = 'DC_TRUCK'
          AND truck.warehouse_id = ?
          AND truck.user_truck_id = ?
          AND COALESCE(truck.is_deleted, 'N') = 'N'
        LIMIT 1
        FOR UPDATE
      `,
      [truckLoadId, warehouseId, actorId],
    );
    const truck = truckRows[0];

    if (!truck) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ success: false, message: "ไม่พบใบรถกระจายของคุณ" });
    }

    if (truck.is_close === "Y" && truck.is_go === "Y") {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ success: false, message: "ใบรถกระจายนี้ปิดบรรทุกและปล่อยรถแล้ว" });
    }

    if (Number(truck.serial_count || 0) <= 0) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ success: false, message: "ใบรถกระจายยังไม่มี Serial No" });
    }

    const [[activeProducts]] = await connection.query(
      `
        SELECT COUNT(*) AS total
        FROM tm_product_trucks product_truck
        WHERE product_truck.truck_load_id = ?
          AND EXISTS (
            SELECT 1 FROM tm_product_actived product_active
            WHERE product_active.serial_id = product_truck.serial_id
              AND product_active.serial_no = product_truck.serial_no
          )
      `,
      [truckLoadId],
    );
    if (Number(activeProducts.total) === 0) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ success: false, message: "ใบรถกระจายไม่มีสินค้าที่ยังไม่ปิดงาน" });
    }

    const [[clock]] = await connection.query(`
      SELECT
        DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+07:00'), '%Y-%m-%d %H:%i:%s') AS now,
        DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+07:00'), '%y%m%d') AS date_code,
        YEAR(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+07:00')) AS data_year,
        DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+07:00'), '%Y%m') AS data_yearmonth
    `);
    const truckCode = await createClosedDeliveryTruckCode(connection, clock.date_code);
    const relativeDirectory = path.posix.join("truck-closes", truckCode.replaceAll("-", ""));
    const absoluteDirectory = path.join(uploadsDirectory, ...relativeDirectory.split("/"));
    const absolutePath = path.join(absoluteDirectory, photo.storedName);
    const filePath = `/uploads/${relativeDirectory}/${photo.storedName}`;

    await fs.mkdir(absoluteDirectory, { recursive: true });
    await fs.writeFile(absolutePath, photo.buffer);
    createdFiles.push(absolutePath);

    await connection.query(
      `
        INSERT INTO tm_truck_close_media (
          truck_load_id, file_name, file_path, mime_type, file_size,
          latitude, longitude, accuracy_m, created_by, created_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        truckLoadId,
        photo.storedName,
        filePath,
        photo.mimetype,
        photo.size,
        latitude,
        longitude,
        accuracyM,
        actorId,
        clock.now,
      ],
    );

    await connection.query(
      `
        UPDATE tm_trucks
        SET
          truck_code = ?,
          close_by = COALESCE(close_by, ?),
          close_datetime = COALESCE(close_datetime, ?),
          go_by = COALESCE(go_by, ?),
          go_datetime = COALESCE(go_datetime, ?),
          is_close = 'Y',
          is_go = 'Y'
        WHERE id = ?
      `,
      [truckCode, actorId, clock.now, actorId, clock.now, truckLoadId],
    );

    await connection.query(
      `UPDATE tm_product_trucks product_truck
       SET product_truck.status = 'IN_TRANSIT'
       WHERE product_truck.truck_load_id = ? AND product_truck.status = 'LOADED'
         AND EXISTS (
           SELECT 1 FROM tm_product_actived product_active
           WHERE product_active.serial_id = product_truck.serial_id
             AND product_active.serial_no = product_truck.serial_no
         )`,
      [truckLoadId],
    );

    if (truck.is_close !== "Y") {
      await writeDeliveryTruckTransactions({
        connection,
        truckLoadId,
        actorId,
        statusId: 8,
        statusMessage: "ปิดบรรทุก",
        now: clock.now,
        dataYear: clock.data_year,
        dataYearmonth: clock.data_yearmonth,
      });
    }

    if (truck.is_go !== "Y") {
      await connection.query(
        `
          INSERT INTO logs_product_trucks (
            product_truck_id, serial_id, serial_no, event_type, created_by,
            user_truck_id, driver_name, truck_id, truck_license_plate,
            license_plate_province_id, status, truck_load_id, is_dc_mismatch,
            parcel_to_warehouse_id, truck_to_warehouse_id,
            is_route_mismatch, parcel_route_id, truck_route_id, created_date
          )
          SELECT
            product_truck.id,
            product_truck.serial_id,
            product_truck.serial_no,
            'DISPATCH_DT',
            ?,
            product_truck.user_truck_id,
            COALESCE(product_truck.driver_name, truck.driver_name),
            product_truck.truck_id,
            ${truckVehicleSql.licensePlate},
            ${truckVehicleSql.licensePlateProvinceId},
            'IN_TRANSIT',
            product_truck.truck_load_id,
            'N',
            receive_serial.to_warehouse_id,
            NULL,
            CASE
              WHEN product_truck.route_id IS NULL OR truck.route_id IS NULL THEN NULL
              WHEN product_truck.route_id <> truck.route_id THEN 'Y'
              ELSE 'N'
            END,
            product_truck.route_id,
            truck.route_id,
            ?
          FROM tm_product_trucks product_truck
          INNER JOIN tm_trucks truck ON truck.id = product_truck.truck_load_id
          INNER JOIN tm_product_actived product_active
            ON product_active.serial_id = product_truck.serial_id
            AND product_active.serial_no = product_truck.serial_no
          LEFT JOIN mm_vehicles vehicle ON vehicle.id = product_truck.truck_id
          LEFT JOIN mm_vehicles_contractor contractor_vehicle ON contractor_vehicle.id = truck.vehicle_contractor_id
          LEFT JOIN tm_receive_serials receive_serial
            ON receive_serial.serial_id = product_truck.serial_id
            AND receive_serial.serial_no = product_truck.serial_no
          WHERE product_truck.truck_load_id = ?
            AND product_truck.status = 'IN_TRANSIT'
        `,
        [actorId, clock.now, truckLoadId],
      );

      await writeDeliveryTruckTransactions({
        connection,
        truckLoadId,
        actorId,
        statusId: 9,
        statusMessage: "กำลังนำจ่ายพัสดุ",
        now: clock.now,
        dataYear: clock.data_year,
        dataYearmonth: clock.data_yearmonth,
      });
    }

    await connection.commit();
    transactionStarted = false;

    return res.status(200).json({ success: true, message: "ปิดบรรทุกและปล่อยรถสำเร็จ", data: { truck_code: truckCode, file_path: filePath } });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    await Promise.all(createdFiles.map((filePath) => fs.unlink(filePath).catch(() => undefined)));
    console.error("closeAndGoDriverDeliveryTruck error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถปิดบรรทุกและปล่อยรถได้" });
  } finally {
    connection?.release();
  }
};
