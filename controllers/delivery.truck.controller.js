import db from "../config/db.js";
import { cleanCode, cleanDbText, toNumberOrNull } from "../utils/cleanText.js";
import { syncTruckBoxCount } from "../utils/truckUtils.js";

const getActorId = (req) => toNumberOrNull(req.user?.id ?? req.user?.user_id);

const getWarehouseId = (req) => toNumberOrNull(req.user?.warehouse_id);

const createTemporaryTruckCode = async (connection, now) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const getPart = (type) => parts.find((part) => part.type === type)?.value || "";
  const dateCode = `${getPart("year")}${getPart("month")}${getPart("day")}`;
  const temporaryCodePrefix = `${dateCode}-`;
  const lockName = `delivery_truck_temporary_code_${dateCode}`;
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
          AND CHAR_LENGTH(truck_code) = 11
      `,
      [`${temporaryCodePrefix}%`],
    );
    const nextRunning = Number(runningRow.last_no) + 1;

    if (nextRunning > 9999) {
      throw new Error("delivery truck code running number is exhausted for today");
    }

    return `${temporaryCodePrefix}${String(nextRunning).padStart(4, "0")}`;
  } finally {
    if (hasLock) {
      await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
    }
  }
};

const createClosedDeliveryTruckCode = async (connection, now) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const getPart = (type) => parts.find((part) => part.type === type)?.value || "";
  const dateCode = `${getPart("year")}${getPart("month")}${getPart("day")}`;
  const codePrefix = `DT-${dateCode}-`;
  const lockName = `delivery_truck_code_${dateCode}`;
  let hasLock = false;

  try {
    const [[lockRow]] = await connection.query("SELECT GET_LOCK(?, 10) AS lock_acquired", [lockName]);

    if (Number(lockRow.lock_acquired) !== 1) {
      throw new Error("unable to reserve closed delivery truck code running number");
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

const writeDeliveryTruckTransactions = async ({ connection, truckLoadId, actorId, statusId, statusMessage, now }) => {
  const dataYear = now.getFullYear();
  const dataYearmonth = dataYear * 100 + now.getMonth() + 1;

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
        ?, ?, ?, NULL, 'PUBLIC',
        truck.warehouse_id, actor.id, transaction_last.latitude, transaction_last.longitude, warehouse.warehouse_name,
        transaction_last.address, transaction_last.province_name, transaction_last.district_name, transaction_last.subdistrict_name, transaction_last.zip_code,
        TRIM(CONCAT_WS(' ', NULLIF(actor.first_name, ''), NULLIF(actor.last_name, ''))),
        actor.username,
        COALESCE(vehicle.license_plate, contractor_vehicle.license_plate),
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
        transaction_last.type = 'PUBLIC',
        transaction_last.warehouse_id = truck.warehouse_id,
        transaction_last.created_by = actor.id,
        transaction_last.warehouse_name = warehouse.warehouse_name,
        transaction_last.created_name = TRIM(CONCAT_WS(' ', NULLIF(actor.first_name, ''), NULLIF(actor.last_name, ''))),
        transaction_last.username = actor.username,
        transaction_last.truck_license_plate = COALESCE(vehicle.license_plate, contractor_vehicle.license_plate),
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

export const getDeliveryTruckOptions = async (req, res) => {
  try {
    const warehouseId = getWarehouseId(req);

    if (!warehouseId) {
      return res.status(400).json({ success: false, message: "ผู้ใช้งานยังไม่ได้กำหนด Warehouse" });
    }

    const [driverRows, vehicleRows, contractorRows, routeRows] = await Promise.all([
      db.query(`
        SELECT id, employee_code, first_name, last_name, tel
        FROM um_users
        WHERE role_id = 7
          AND COALESCE(employment_type, 'EMPLOYEE') = 'EMPLOYEE'
          AND COALESCE(is_active, 1) = 1
        ORDER BY first_name, last_name
      `),
      db.query(`
        SELECT id, license_plate, license_plate_province, model
        FROM mm_vehicles
        WHERE status = 'ACTIVE'
          AND is_deleted = 'N'
        ORDER BY license_plate
      `),
      db.query(`
        SELECT
          vehicle.id AS vehicle_contractor_id,
          vehicle.user_truck_id,
          vehicle.license_plate,
          province.province_name AS license_plate_province,
          vehicle.model,
          driver.employee_code,
          driver.first_name,
          driver.last_name,
          driver.tel
        FROM mm_vehicles_contractor vehicle
        INNER JOIN um_users driver
          ON driver.id = vehicle.user_truck_id
        LEFT JOIN mm_province province
          ON province.id = vehicle.license_plate_province_id
        WHERE vehicle.is_deleted = 'N'
          AND COALESCE(driver.is_active, 1) = 1
          AND driver.role_id = 7
          AND COALESCE(driver.employment_type, 'EMPLOYEE') = 'CONTRACTOR'
        ORDER BY driver.first_name, driver.last_name, vehicle.license_plate
      `),
      db.query(
        `
          SELECT route_id, warehouse_id, route_code, route_name
          FROM mm_routes
          WHERE warehouse_id = ?
            AND COALESCE(is_deleted, 'N') = 'N'
          ORDER BY route_code, route_name
        `,
        [warehouseId],
      ),
    ]);

    res.json({
      success: true,
      data: {
        drivers: driverRows[0],
        vehicles: vehicleRows[0],
        contractors: contractorRows[0],
        routes: routeRows[0],
      },
    });
  } catch (error) {
    console.error("getDeliveryTruckOptions error:", error);
    res.status(500).json({ success: false, message: "ไม่สามารถโหลดข้อมูลคนขับและรถได้" });
  }
};

export const getDeliveryTrucks = async (req, res) => {
  try {
    const warehouseId = getWarehouseId(req);

    if (!warehouseId) {
      return res.status(400).json({ success: false, message: "ผู้ใช้งานยังไม่ได้กำหนด Warehouse" });
    }

    const [rows] = await db.query(
      `
        SELECT
          truck.id AS truck_load_id,
          truck.truck_code,
          truck.create_date,
          truck.driver_type,
          truck.status,
          truck.is_close,
          truck.is_go,
          truck.is_completed,
          truck.user_truck_id,
          truck.vehicle_id,
          truck.vehicle_contractor_id,
          truck.route_id,
          COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(driver.first_name, ''), NULLIF(driver.last_name, '')), ''), truck.driver_name) AS driver_name,
          driver.tel,
          COALESCE(vehicle.license_plate, contractor_vehicle.license_plate) AS license_plate,
          COALESCE(vehicle.license_plate_province, contractor_province.province_name) AS license_plate_province,
          route.route_code,
          route.route_name,
          COALESCE(truck_count.count_box, 0) AS count_box
        FROM tm_trucks truck
        LEFT JOIN um_users driver
          ON driver.id = truck.user_truck_id
        LEFT JOIN mm_vehicles vehicle
          ON vehicle.id = truck.vehicle_id
        LEFT JOIN mm_vehicles_contractor contractor_vehicle
          ON contractor_vehicle.id = truck.vehicle_contractor_id
        LEFT JOIN mm_province contractor_province
          ON contractor_province.id = contractor_vehicle.license_plate_province_id
        LEFT JOIN tm_truck_count truck_count
          ON truck_count.truck_load_id = truck.id
        LEFT JOIN mm_routes route
          ON route.route_id = truck.route_id
        WHERE truck.status = 'DC_TRUCK'
          AND truck.warehouse_id = ?
          AND COALESCE(truck.is_deleted, 'N') = 'N'
        ORDER BY truck.id DESC
      `,
      [warehouseId],
    );

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getDeliveryTrucks error:", error);
    res.status(500).json({ success: false, message: "ไม่สามารถโหลดรายการใบรถกระจายได้" });
  }
};

export const getDeliveryTruckById = async (req, res) => {
  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const warehouseId = getWarehouseId(req);

    if (!truckLoadId || !warehouseId) {
      return res.status(400).json({ success: false, message: "ข้อมูลใบรถกระจายไม่ถูกต้อง" });
    }

    const [rows] = await db.query(
      `
        SELECT
          truck.id AS truck_load_id,
          truck.truck_code,
          truck.warehouse_id,
          truck.route_id,
          truck.user_truck_id,
          truck.driver_type,
          truck.is_close,
          truck.is_go,
          warehouse.warehouse_name,
          driver.employee_code,
          COALESCE(NULLIF(CONCAT_WS(' ', NULLIF(driver.first_name, ''), NULLIF(driver.last_name, '')), ''), truck.driver_name) AS driver_name,
          COALESCE(vehicle.license_plate, contractor_vehicle.license_plate) AS license_plate,
          COALESCE(vehicle.license_plate_province, contractor_province.province_name) AS license_plate_province,
          COALESCE(vehicle.model, contractor_vehicle.model) AS model,
          route.route_code,
          route.route_name
        FROM tm_trucks truck
        LEFT JOIN mm_warehouses_to warehouse ON warehouse.warehouse_id = truck.warehouse_id
        LEFT JOIN um_users driver ON driver.id = truck.user_truck_id
        LEFT JOIN mm_vehicles vehicle ON vehicle.id = truck.vehicle_id
        LEFT JOIN mm_vehicles_contractor contractor_vehicle ON contractor_vehicle.id = truck.vehicle_contractor_id
        LEFT JOIN mm_province contractor_province ON contractor_province.id = contractor_vehicle.license_plate_province_id
        LEFT JOIN mm_routes route ON route.route_id = truck.route_id
        WHERE truck.id = ?
          AND truck.status = 'DC_TRUCK'
          AND truck.warehouse_id = ?
          AND COALESCE(truck.is_deleted, 'N') = 'N'
        LIMIT 1
      `,
      [truckLoadId, warehouseId],
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "ไม่พบใบรถกระจาย" });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("getDeliveryTruckById error:", error);
    res.status(500).json({ success: false, message: "ไม่สามารถโหลดข้อมูลใบรถกระจายได้" });
  }
};

export const getDeliveryTruckProducts = async (req, res) => {
  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const warehouseId = getWarehouseId(req);

    if (!truckLoadId || !warehouseId) {
      return res.status(400).json({ success: false, message: "ข้อมูลใบรถกระจายไม่ถูกต้อง" });
    }

    const [truckRows] = await db.query(
      `
        SELECT warehouse_id
        FROM tm_trucks
        WHERE id = ?
          AND status = 'DC_TRUCK'
          AND warehouse_id = ?
          AND COALESCE(is_deleted, 'N') = 'N'
        LIMIT 1
      `,
      [truckLoadId, warehouseId],
    );
    const truck = truckRows[0];

    if (!truck) {
      return res.status(404).json({ success: false, message: "ไม่พบใบรถกระจาย" });
    }

    const [rows] = await db.query(
      `
        SELECT
          product_warehouse.id AS product_warehouse_id,
          product_warehouse.serial_id,
          product_warehouse.serial_no,
          product_warehouse.now_warehouse_id,
          product_warehouse.to_warehouse_id,
          product_warehouse.route_id,
          receive_serial.customer_id,
          customer.name AS customer_name,
          receive_serial.recipient_name
        FROM tm_product_warehouses product_warehouse
        INNER JOIN tm_product_actived product_active
          ON product_active.serial_id = product_warehouse.serial_id
          AND product_active.serial_no = product_warehouse.serial_no
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_warehouse.serial_id
          AND receive_serial.serial_no = product_warehouse.serial_no
        LEFT JOIN mm_customers customer
          ON customer.id = receive_serial.customer_id
        WHERE product_warehouse.now_warehouse_id = ?
          AND product_warehouse.to_warehouse_id = ?
          AND NULLIF(TRIM(product_warehouse.serial_no), '') IS NOT NULL
        ORDER BY product_warehouse.id ASC
      `,
      [truck.warehouse_id, truck.warehouse_id],
    );

    const [loadedRows] = await db.query(
      `
        SELECT
          product_truck.serial_id,
          product_truck.serial_no,
          receive_serial.recipient_name
        FROM tm_product_trucks product_truck
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_truck.serial_id
          AND receive_serial.serial_no = product_truck.serial_no
        WHERE product_truck.truck_load_id = ?
          AND product_truck.status IN ('LOADED', 'DELIVERING')
        ORDER BY product_truck.id DESC
      `,
      [truckLoadId],
    );

    res.json({ success: true, data: rows, loaded: loadedRows });
  } catch (error) {
    console.error("getDeliveryTruckProducts error:", error);
    res.status(500).json({ success: false, message: "ไม่สามารถโหลดรายการสินค้าในคลังได้" });
  }
};

export const getDeliveryTruckPrint = async (req, res) => {
  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const warehouseId = getWarehouseId(req);

    if (!truckLoadId || !warehouseId) {
      return res.status(400).json({ success: false, message: "ข้อมูลใบรถกระจายไม่ถูกต้อง" });
    }

    const [truckRows] = await db.query(
      `
        SELECT
          truck.id AS truck_load_id,
          truck.truck_code,
          truck.create_date,
          truck.driver_name,
          truck.close_datetime,
          warehouse.warehouse_name,
          route.route_code,
          route.route_name,
          COALESCE(vehicle.license_plate, contractor_vehicle.license_plate) AS license_plate,
          COALESCE(vehicle.license_plate_province, contractor_province.province_name) AS license_province,
          COALESCE(truck_count.count_box, 0) AS serial_count
        FROM tm_trucks truck
        LEFT JOIN mm_warehouses_to warehouse
          ON warehouse.warehouse_id = truck.warehouse_id
        LEFT JOIN mm_routes route
          ON route.route_id = truck.route_id
        LEFT JOIN mm_vehicles vehicle
          ON vehicle.id = truck.vehicle_id
        LEFT JOIN mm_vehicles_contractor contractor_vehicle
          ON contractor_vehicle.id = truck.vehicle_contractor_id
        LEFT JOIN mm_province contractor_province
          ON contractor_province.id = contractor_vehicle.license_plate_province_id
        LEFT JOIN tm_truck_count truck_count
          ON truck_count.truck_load_id = truck.id
        WHERE truck.id = ?
          AND truck.status = 'DC_TRUCK'
          AND truck.warehouse_id = ?
          AND COALESCE(truck.is_deleted, 'N') = 'N'
        LIMIT 1
      `,
      [truckLoadId, warehouseId],
    );
    const truck = truckRows[0];

    if (!truck) {
      return res.status(404).json({ success: false, message: "ไม่พบใบรถกระจาย" });
    }

    const [items] = await db.query(
      `
        SELECT
          MIN(detail.id) AS id,
          MAX(receive_serial.receive_code) AS receive_code,
          MAX(receive_serial.delivery_date) AS delivery_date,
          MAX(ref.reference_no) AS reference_no,
          MAX(customer.name) AS customer_name,
          MAX(receive_serial.recipient_name) AS recipient_name,
          MAX(receive_serial.address) AS address,
          MAX(receive_serial.subdistrict_name) AS subdistrict_name,
          MAX(receive_serial.district_name) AS district_name,
          MAX(receive_serial.province_name) AS province_name,
          MAX(receive_serial.zip_code) AS zip_code,
          MAX(receive_serial.tel) AS recipient_tel,
          COUNT(DISTINCT detail.serial_no) AS qty
        FROM tm_truck_details detail
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = detail.serial_id
          AND receive_serial.serial_no = detail.serial_no
        LEFT JOIN (
          SELECT receive_id, MAX(reference_no) AS reference_no
          FROM tm_receive_references
          GROUP BY receive_id
        ) ref
          ON ref.receive_id = CASE
            WHEN UPPER(receive_serial.customer_type) = 'BUSINESS' THEN receive_serial.receive_business_id
            WHEN UPPER(receive_serial.customer_type) = 'EXPRESS' THEN receive_serial.receive_walkin_id
            ELSE NULL
          END
        LEFT JOIN mm_customers customer
          ON customer.id = receive_serial.customer_id
        WHERE detail.truck_load_id = ?
        GROUP BY receive_serial.receive_code
        ORDER BY MIN(detail.id) ASC
      `,
      [truckLoadId],
    );

    res.json({ success: true, data: { truck, items } });
  } catch (error) {
    console.error("getDeliveryTruckPrint error:", error);
    res.status(500).json({ success: false, message: "ไม่สามารถโหลดข้อมูลสำหรับพิมพ์ได้" });
  }
};

export const closeAndGoDeliveryTruck = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const actorId = getActorId(req);
    const warehouseId = getWarehouseId(req);

    if (!truckLoadId || !actorId || !warehouseId) {
      return res.status(400).json({ success: false, message: "ข้อมูลใบรถกระจายไม่ถูกต้อง" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const now = new Date();

    const [rows] = await connection.query(
      `
        SELECT
          truck.id,
          truck.is_close,
          truck.is_go,
          (SELECT COUNT(*) FROM tm_truck_details detail WHERE detail.truck_load_id = truck.id) AS serial_count
        FROM tm_trucks truck
        WHERE truck.id = ?
          AND truck.status = 'DC_TRUCK'
          AND truck.warehouse_id = ?
          AND COALESCE(truck.is_deleted, 'N') = 'N'
        LIMIT 1
        FOR UPDATE
      `,
      [truckLoadId, warehouseId],
    );
    const truck = rows[0];

    if (!truck) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ success: false, message: "ไม่พบใบรถกระจาย" });
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

    const truckCode = await createClosedDeliveryTruckCode(connection, now);

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
      [truckCode, actorId, now, actorId, now, truckLoadId],
    );

    await connection.query(
      `UPDATE tm_product_trucks SET status = 'DELIVERING' WHERE truck_load_id = ? AND status = 'LOADED'`,
      [truckLoadId],
    );

    if (truck.is_close !== "Y") {
      await writeDeliveryTruckTransactions({
        connection,
        truckLoadId,
        actorId,
        statusId: 8,
        statusMessage: "ปิดบรรทุก",
        now,
      });
    }

    if (truck.is_go !== "Y") {
      await writeDeliveryTruckTransactions({
        connection,
        truckLoadId,
        actorId,
        statusId: 5,
        statusMessage: "พัสดุออกจากศูนย์",
        now,
      });
    }

    await connection.commit();
    transactionStarted = false;

    return res.status(200).json({ success: true, message: "ปิดบรรทุกและปล่อยรถสำเร็จ" });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    console.error("closeAndGoDeliveryTruck error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถปิดบรรทุกและปล่อยรถได้" });
  } finally {
    connection?.release();
  }
};

export const loadDeliveryTruckProduct = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const serialNo = cleanCode(req.body.serial_no);
    const confirmRouteWarning = req.body.confirm_route_warning === true;
    const actorId = getActorId(req);
    const warehouseId = getWarehouseId(req);

    if (!truckLoadId || !serialNo || !actorId || !warehouseId) {
      return res.status(400).json({ success: false, message: "ข้อมูล Serial No หรือใบรถกระจายไม่ถูกต้อง" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const now = new Date();

    const [truckRows] = await connection.query(
      `
        SELECT id, warehouse_id, route_id, user_truck_id, driver_name, vehicle_id, vehicle_contractor_id, is_close
        FROM tm_trucks
        WHERE id = ?
          AND status = 'DC_TRUCK'
          AND warehouse_id = ?
          AND COALESCE(is_deleted, 'N') = 'N'
        LIMIT 1
        FOR UPDATE
      `,
      [truckLoadId, warehouseId],
    );
    const truck = truckRows[0];

    if (!truck) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ success: false, message: "ไม่พบใบรถกระจาย" });
    }

    if (truck.is_close === "Y") {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ success: false, message: "ใบรถกระจายนี้ปิดบรรทุกแล้ว" });
    }

    const [productRows] = await connection.query(
      `
        SELECT product_warehouse.id, product_warehouse.serial_id, product_warehouse.serial_no,
          product_warehouse.to_warehouse_id, product_warehouse.route_id, product_warehouse.resend_date
        FROM tm_product_warehouses product_warehouse
        INNER JOIN tm_product_actived product_active
          ON product_active.serial_id = product_warehouse.serial_id
          AND product_active.serial_no = product_warehouse.serial_no
        WHERE product_warehouse.serial_no = ?
          AND product_warehouse.now_warehouse_id = ?
          AND product_warehouse.to_warehouse_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [serialNo, truck.warehouse_id, truck.warehouse_id],
    );
    const product = productRows[0];

    if (!product) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ success: false, message: "ไม่พบ Serial No ในคลังนี้" });
    }

    const routeWarningCode = product.route_id === null
      ? "ROUTE_MISSING"
      : String(product.route_id) !== String(truck.route_id)
        ? "ROUTE_MISMATCH"
        : null;

    if (routeWarningCode && !confirmRouteWarning) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({
        success: false,
        code: routeWarningCode,
        message: routeWarningCode === "ROUTE_MISSING" ? "สินค้านี้ยังไม่ได้กำหนดสายรถ" : "สินค้านี้อยู่คนละสายรถกับใบรถกระจาย",
        data: { serial_no: product.serial_no, route_id: product.route_id },
      });
    }

    const [activeRows] = await connection.query(
      `SELECT id FROM tm_product_trucks WHERE serial_id = ? AND status IN ('LOADED', 'DELIVERING') LIMIT 1`,
      [product.serial_id],
    );

    if (activeRows.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ success: false, message: "Serial No นี้อยู่บนรถแล้ว" });
    }

    const [vehicleRows] = await connection.query(
      `
        SELECT
          COALESCE(vehicle.license_plate, contractor_vehicle.license_plate) AS license_plate,
          COALESCE(vehicle.license_plate_province_id, contractor_vehicle.license_plate_province_id) AS license_plate_province_id
        FROM tm_trucks truck
        LEFT JOIN mm_vehicles vehicle ON vehicle.id = truck.vehicle_id
        LEFT JOIN mm_vehicles_contractor contractor_vehicle ON contractor_vehicle.id = truck.vehicle_contractor_id
        WHERE truck.id = ?
      `,
      [truckLoadId],
    );
    const vehicle = vehicleRows[0] || {};

    const [productTruckResult] = await connection.query(
      `
        INSERT INTO tm_product_trucks (
          serial_id, serial_no, created_by, user_truck_id, driver_name,
          truck_id, status, resend_date, truck_load_id, route_id, created_date
        )
        VALUES (?, ?, ?, ?, ?, ?, 'LOADED', ?, ?, ?, ?)
      `,
      [product.serial_id, product.serial_no, actorId, truck.user_truck_id, truck.driver_name, truck.vehicle_id ?? truck.vehicle_contractor_id, product.resend_date, truckLoadId, product.route_id, now],
    );

    await connection.query(
      `
        INSERT INTO tm_truck_details (truck_load_id, serial_id, serial_no, create_date, is_receive)
        VALUES (?, ?, ?, ?, 'N')
      `,
      [truckLoadId, product.serial_id, product.serial_no, now],
    );

    await connection.query(
      `
        INSERT INTO logs_product_trucks (
          product_truck_id, serial_id, serial_no, event_type, created_by,
          user_truck_id, driver_name, truck_id, truck_license_plate,
          license_plate_province_id, status, truck_load_id, is_dc_mismatch,
          parcel_to_warehouse_id, truck_to_warehouse_id, created_date
        )
        VALUES (?, ?, ?, 'LOAD', ?, ?, ?, ?, ?, ?, 'LOADED', ?, 'N', ?, NULL, ?)
      `,
      [productTruckResult.insertId, product.serial_id, product.serial_no, actorId, truck.user_truck_id, truck.driver_name, truck.vehicle_id ?? truck.vehicle_contractor_id, vehicle.license_plate || null, vehicle.license_plate_province_id || null, truckLoadId, product.to_warehouse_id, now],
    );

    await connection.query(
      `
        INSERT INTO logs_product_warehouses (
          product_warehouse_id, serial_id, serial_no, event_type,
          now_warehouse_id, to_warehouse_id, created_by, created_date
        )
        VALUES (?, ?, ?, 'TRUCK_OUT', ?, ?, ?, ?)
      `,
      [product.id, product.serial_id, product.serial_no, truck.warehouse_id, product.to_warehouse_id, actorId, now],
    );

    await connection.query(`DELETE FROM tm_product_warehouses WHERE id = ?`, [product.id]);
    await syncTruckBoxCount(connection, truckLoadId);
    await connection.commit();
    transactionStarted = false;

    res.status(201).json({ success: true, message: `ยิง SN ${product.serial_no} ขึ้นรถสำเร็จ` });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    console.error("loadDeliveryTruckProduct error:", error);
    res.status(500).json({ success: false, message: "ไม่สามารถยิงสินค้าขึ้นรถได้" });
  } finally {
    connection?.release();
  }
};

export const unloadDeliveryTruckProduct = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const serialNo = cleanCode(req.body.serial_no);
    const actorId = getActorId(req);
    const warehouseId = getWarehouseId(req);

    if (!truckLoadId || !serialNo || !actorId || !warehouseId) {
      return res.status(400).json({ success: false, message: "ข้อมูล Serial No หรือใบรถกระจายไม่ถูกต้อง" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const now = new Date();

    const [rows] = await connection.query(
      `
        SELECT
          product_truck.id, product_truck.serial_id, product_truck.serial_no,
          product_truck.resend_date, product_truck.user_truck_id, product_truck.driver_name,
          product_truck.truck_id, product_truck.status, truck.warehouse_id,
          product_truck.route_id, receive_serial.to_warehouse_id
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck ON truck.id = product_truck.truck_load_id
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_truck.serial_id
          AND receive_serial.serial_no = product_truck.serial_no
        WHERE product_truck.truck_load_id = ?
          AND product_truck.serial_no = ?
          AND truck.status = 'DC_TRUCK'
          AND truck.warehouse_id = ?
          AND product_truck.status = 'LOADED'
        LIMIT 1
        FOR UPDATE
      `,
      [truckLoadId, serialNo, warehouseId],
    );
    const product = rows[0];

    if (!product) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ success: false, message: "ไม่พบ Serial No ในใบรถกระจาย" });
    }

    const [warehouseResult] = await connection.query(
      `
        INSERT INTO tm_product_warehouses (
          serial_id, serial_no, now_warehouse_id, to_warehouse_id,
          route_id, resend_date, created_by, created_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [product.serial_id, product.serial_no, product.warehouse_id, product.to_warehouse_id, product.route_id, product.resend_date, actorId, now],
    );

    await connection.query(`DELETE FROM tm_truck_details WHERE truck_load_id = ? AND serial_no = ?`, [truckLoadId, serialNo]);
    await connection.query(`DELETE FROM tm_product_trucks WHERE id = ?`, [product.id]);

    await connection.query(
      `
        INSERT INTO logs_product_warehouses (
          product_warehouse_id, serial_id, serial_no, event_type,
          now_warehouse_id, to_warehouse_id, created_by, created_date
        )
        VALUES (?, ?, ?, 'RECEIVE_IN', ?, ?, ?, ?)
      `,
      [warehouseResult.insertId, product.serial_id, product.serial_no, product.warehouse_id, product.to_warehouse_id, actorId, now],
    );

    await connection.query(
      `
        INSERT INTO logs_product_trucks (
          product_truck_id, serial_id, serial_no, event_type, created_by,
          user_truck_id, driver_name, truck_id, status, truck_load_id, is_dc_mismatch,
          parcel_to_warehouse_id, truck_to_warehouse_id, created_date
        )
        VALUES (?, ?, ?, 'UNLOAD', ?, ?, ?, ?, ?, ?, 'N', ?, NULL, ?)
      `,
      [product.id, product.serial_id, product.serial_no, actorId, product.user_truck_id, product.driver_name, product.truck_id, product.status, truckLoadId, product.to_warehouse_id, now],
    );

    await syncTruckBoxCount(connection, truckLoadId);
    await connection.commit();
    transactionStarted = false;
    res.json({ success: true, message: `นำ SN ${product.serial_no} กลับคลังสำเร็จ` });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    console.error("unloadDeliveryTruckProduct error:", error);
    res.status(500).json({ success: false, message: "ไม่สามารถนำสินค้าออกจากรถได้" });
  } finally {
    connection?.release();
  }
};

export const deleteDeliveryTruck = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const actorId = getActorId(req);
    const warehouseId = getWarehouseId(req);

    if (!truckLoadId || !actorId || !warehouseId) {
      return res.status(400).json({ success: false, message: "ข้อมูลใบรถกระจายไม่ถูกต้อง" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const now = new Date();

    const [truckRows] = await connection.query(
      `
        SELECT id, warehouse_id, route_id
        FROM tm_trucks
        WHERE id = ?
          AND status = 'DC_TRUCK'
          AND warehouse_id = ?
          AND COALESCE(is_deleted, 'N') = 'N'
          AND COALESCE(is_go, 'N') = 'N'
        LIMIT 1
        FOR UPDATE
      `,
      [truckLoadId, warehouseId],
    );
    const truck = truckRows[0];

    if (!truck) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ success: false, message: "ไม่พบใบรถกระจาย หรือใบรถถูกปล่อยแล้ว" });
    }

    const [activeProductRows] = await connection.query(
      `SELECT id FROM tm_product_trucks WHERE truck_load_id = ? LIMIT 1 FOR UPDATE`,
      [truckLoadId],
    );

    if (activeProductRows.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ success: false, message: "ไม่สามารถลบใบรถกระจายได้ เนื่องจากยังมีสินค้าอยู่บนรถ" });
    }

    const [products] = await connection.query(
      `
        SELECT
          product_truck.id, product_truck.serial_id, product_truck.serial_no,
          product_truck.resend_date, product_truck.user_truck_id,
          product_truck.driver_name, product_truck.truck_id, product_truck.status,
          product_truck.route_id, receive_serial.to_warehouse_id
        FROM tm_product_trucks product_truck
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_truck.serial_id
          AND receive_serial.serial_no = product_truck.serial_no
        WHERE product_truck.truck_load_id = ?
          AND product_truck.status = 'LOADED'
        FOR UPDATE
      `,
      [truckLoadId],
    );

    for (const product of products) {
      const [warehouseResult] = await connection.query(
        `
          INSERT INTO tm_product_warehouses (
            serial_id, serial_no, now_warehouse_id, to_warehouse_id,
            route_id, resend_date, created_by, created_date
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [product.serial_id, product.serial_no, truck.warehouse_id, product.to_warehouse_id, product.route_id, product.resend_date, actorId, now],
      );

      await connection.query(
        `
          INSERT INTO logs_product_warehouses (
            product_warehouse_id, serial_id, serial_no, event_type,
            now_warehouse_id, to_warehouse_id, created_by, created_date
          )
          VALUES (?, ?, ?, 'RECEIVE_IN', ?, ?, ?, ?)
        `,
        [warehouseResult.insertId, product.serial_id, product.serial_no, truck.warehouse_id, product.to_warehouse_id, actorId, now],
      );

      await connection.query(
        `
          INSERT INTO logs_product_trucks (
            product_truck_id, serial_id, serial_no, event_type, created_by,
            user_truck_id, driver_name, truck_id, status, truck_load_id,
            is_dc_mismatch, parcel_to_warehouse_id, truck_to_warehouse_id, created_date
          )
          VALUES (?, ?, ?, 'UNLOAD', ?, ?, ?, ?, ?, ?, 'N', ?, NULL, ?)
        `,
        [product.id, product.serial_id, product.serial_no, actorId, product.user_truck_id, product.driver_name, product.truck_id, product.status, truckLoadId, product.to_warehouse_id, now],
      );
    }

    await connection.query(`DELETE FROM tm_truck_details WHERE truck_load_id = ?`, [truckLoadId]);
    await connection.query(`DELETE FROM tm_product_trucks WHERE truck_load_id = ? AND status = 'LOADED'`, [truckLoadId]);
    await connection.query(`UPDATE tm_trucks SET is_deleted = 'Y', deleted_by = ? WHERE id = ?`, [actorId, truckLoadId]);
    await syncTruckBoxCount(connection, truckLoadId);
    await connection.commit();
    transactionStarted = false;

    res.json({ success: true, message: "ลบใบรถกระจายและคืนสินค้าเข้าคลังสำเร็จ" });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    console.error("deleteDeliveryTruck error:", error);
    res.status(500).json({ success: false, message: "ไม่สามารถลบใบรถกระจายได้" });
  } finally {
    connection?.release();
  }
};

export const createDeliveryTruck = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const createdBy = getActorId(req);
    const warehouseId = getWarehouseId(req);
    const userTruckId = toNumberOrNull(req.body.user_truck_id);
    const vehicleId = toNumberOrNull(req.body.vehicle_id);
    const vehicleContractorId = toNumberOrNull(req.body.vehicle_contractor_id);
    const routeId = toNumberOrNull(req.body.route_id);
    const driverType = String(req.body.driver_type || "EMPLOYEE").toUpperCase() === "CONTRACTOR" ? "CONTRACTOR" : "EMPLOYEE";

    if (!createdBy || !warehouseId || !userTruckId || !routeId) {
      return res.status(400).json({ success: false, message: "ข้อมูลผู้ใช้งานหรือคนขับไม่ถูกต้อง" });
    }

    if (driverType === "EMPLOYEE" && !vehicleId) {
      return res.status(400).json({ success: false, message: "กรุณาเลือกรถ" });
    }

    if (driverType === "CONTRACTOR" && !vehicleContractorId) {
      return res.status(400).json({ success: false, message: "กรุณาเลือกคนขับและรถเสริม" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [driverRows] = await connection.query(
      `
        SELECT id, first_name, last_name
        FROM um_users
        WHERE id = ?
          AND role_id = 7
          AND COALESCE(employment_type, 'EMPLOYEE') = ?
          AND COALESCE(is_active, 1) = 1
        LIMIT 1
      `,
      [userTruckId, driverType],
    );

    const [vehicleRows] = await connection.query(
      driverType === "CONTRACTOR"
        ? `
            SELECT id
            FROM mm_vehicles_contractor
            WHERE id = ?
              AND user_truck_id = ?
              AND is_deleted = 'N'
            LIMIT 1
            FOR UPDATE
          `
        : `
            SELECT id
            FROM mm_vehicles
            WHERE id = ?
              AND status = 'ACTIVE'
              AND is_deleted = 'N'
            LIMIT 1
          `,
      driverType === "CONTRACTOR" ? [vehicleContractorId, userTruckId] : [vehicleId],
    );

    const [routeRows] = await connection.query(
      `
        SELECT route_id
        FROM mm_routes
        WHERE route_id = ?
          AND warehouse_id = ?
          AND COALESCE(is_deleted, 'N') = 'N'
        LIMIT 1
      `,
      [routeId, warehouseId],
    );

    if (!driverRows.length || !vehicleRows.length || !routeRows.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(400).json({ success: false, message: "ไม่พบข้อมูลคนขับหรือรถที่เลือก" });
    }

    const now = new Date();
    const truckCode = await createTemporaryTruckCode(connection, now);
    const driverName = [driverRows[0].first_name, driverRows[0].last_name].filter(Boolean).join(" ") || null;

    const [result] = await connection.query(
      `
        INSERT INTO tm_trucks (
          truck_code, create_date, created_by, user_truck_id,
          driver_type, driver_name, vehicle_id, vehicle_contractor_id,
          status, warehouse_id, route_id, note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DC_TRUCK', ?, ?, ?)
      `,
      [
        truckCode,
        now,
        createdBy,
        userTruckId,
        driverType,
        driverName,
        driverType === "EMPLOYEE" ? vehicleId : null,
        driverType === "CONTRACTOR" ? vehicleContractorId : null,
        warehouseId,
        routeId,
        cleanDbText(req.body.note),
      ],
    );

    await syncTruckBoxCount(connection, result.insertId);

    await connection.commit();
    transactionStarted = false;

    res.status(201).json({
      success: true,
      message: "สร้างใบรถกระจายสำเร็จ",
      data: { truck_load_id: result.insertId, truck_code: truckCode },
    });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    console.error("createDeliveryTruck error:", error);
    res.status(500).json({ success: false, message: "ไม่สามารถสร้างใบรถกระจายได้" });
  } finally {
    connection?.release();
  }
};
