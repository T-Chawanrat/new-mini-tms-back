import db from "../../config/db.js";
import { cleanText, toNumberOrNull } from "../../utils/input.js";
import { buildTruckVehicleSql, syncTruckBoxCount } from "../../utils/truck.js";
import { insertProductTruckLog, insertProductWarehouseLog } from "../../services/product-log.js";

const truckVehicleSql = buildTruckVehicleSql();

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

export const getDriverDeliveryTruckOptions = async (req, res) => {
  try {
    const driverId = getActorId(req);
    const warehouseId = getWarehouseId(req);

    if (!driverId || !warehouseId) {
      return res.status(400).json({ success: false, message: "ข้อมูลผู้ขับรถหรือคลังไม่ถูกต้อง" });
    }

    const [[driverRows], [routeRows]] = await Promise.all([
      db.query(
        `
          SELECT id, role_id, COALESCE(employment_type, 'EMPLOYEE') AS employment_type
          FROM um_users
          WHERE id = ?
            AND role_id IN (1, 7)
            AND COALESCE(is_active, 1) = 1
          LIMIT 1
        `,
        [driverId],
      ),
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

    const driver = driverRows[0];
    if (!driver) {
      return res.status(403).json({ success: false, message: "บัญชีนี้ไม่มีสิทธิ์สร้างใบรถในฐานะคนขับ" });
    }

    const driverType = Number(driver.role_id) === 1 ? "EMPLOYEE" : driver.employment_type === "CONTRACTOR" ? "CONTRACTOR" : "EMPLOYEE";
    const [vehicleRows] = await db.query(
      driverType === "CONTRACTOR"
        ? `
            SELECT vehicle.id AS vehicle_contractor_id, vehicle.license_plate,
              province.province_name AS license_plate_province, vehicle.model
            FROM mm_vehicles_contractor vehicle
            LEFT JOIN mm_province province ON province.id = vehicle.license_plate_province_id
            WHERE vehicle.user_truck_id = ?
              AND vehicle.is_deleted = 'N'
            ORDER BY vehicle.id
          `
        : `
            SELECT id, license_plate, license_plate_province, model
            FROM mm_vehicles
            WHERE status = 'ACTIVE'
              AND is_deleted = 'N'
            ORDER BY license_plate
          `,
      driverType === "CONTRACTOR" ? [driverId] : [],
    );

    if (driverType === "CONTRACTOR" && vehicleRows.length !== 1) {
      return res.status(409).json({
        success: false,
        message: vehicleRows.length ? "พบรถที่ผูกกับคนขับมากกว่าหนึ่งคัน กรุณาให้ผู้ดูแลตรวจสอบข้อมูล" : "ไม่พบรถที่ผูกกับคนขับรายนี้",
      });
    }

    return res.json({
      success: true,
      data: {
        driver_type: driverType,
        routes: routeRows,
        vehicles: driverType === "EMPLOYEE" ? vehicleRows : [],
        contractor_vehicle: driverType === "CONTRACTOR" ? vehicleRows[0] : null,
      },
    });
  } catch (error) {
    console.error("getDriverDeliveryTruckOptions error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดข้อมูลสำหรับสร้างใบรถได้" });
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
        SELECT warehouse_id, route_id
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
          AND product_warehouse.route_id = ?
          AND NULLIF(TRIM(product_warehouse.serial_no), '') IS NOT NULL
        ORDER BY product_warehouse.id ASC
      `,
      [truck.warehouse_id, truck.warehouse_id, truck.route_id],
    );

    const [loadedRows] = await db.query(
      `
        SELECT
          product_truck.serial_id,
          product_truck.serial_no,
          receive_serial.recipient_name
        FROM tm_product_trucks product_truck
        INNER JOIN tm_product_actived product_active
          ON product_active.serial_id = product_truck.serial_id
          AND product_active.serial_no = product_truck.serial_no
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_truck.serial_id
          AND receive_serial.serial_no = product_truck.serial_no
        WHERE product_truck.truck_load_id = ?
          AND product_truck.status IN ('LOADED', 'IN_TRANSIT')
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

export const loadDeliveryTruckProduct = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const serialNo = cleanText(req.body.serial_no);
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
      `SELECT id FROM tm_product_trucks WHERE serial_id = ? AND status IN ('LOADED', 'IN_TRANSIT') LIMIT 1`,
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
          ${truckVehicleSql.licensePlate} AS license_plate,
          ${truckVehicleSql.licensePlateProvinceId} AS license_plate_province_id
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

    await insertProductTruckLog(connection, {
      product_truck_id: productTruckResult.insertId,
      serial_id: product.serial_id,
      serial_no: product.serial_no,
      event_type: "LOAD_DT",
      created_by: actorId,
      user_truck_id: truck.user_truck_id,
      driver_name: truck.driver_name,
      truck_id: truck.vehicle_id ?? truck.vehicle_contractor_id,
      truck_license_plate: vehicle.license_plate || null,
      license_plate_province_id: vehicle.license_plate_province_id || null,
      status: "LOADED",
      truck_load_id: truckLoadId,
      is_dc_mismatch: "N",
      parcel_to_warehouse_id: product.to_warehouse_id,
      truck_to_warehouse_id: null,
      is_route_mismatch: product.route_id == null || truck.route_id == null ? null : routeWarningCode === "ROUTE_MISMATCH" ? "Y" : "N",
      parcel_route_id: product.route_id,
      truck_route_id: truck.route_id,
      created_date: now,
    });

    await insertProductWarehouseLog(connection, {
      product_warehouse_id: product.id,
      serial_id: product.serial_id,
      serial_no: product.serial_no,
      event_type: "TRUCK_OUT",
      now_warehouse_id: truck.warehouse_id,
      to_warehouse_id: product.to_warehouse_id,
      created_by: actorId,
      created_date: now,
    });

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
    const serialNo = cleanText(req.body.serial_no);
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
          truck.is_close, product_truck.route_id, receive_serial.to_warehouse_id
        FROM tm_product_trucks product_truck
        INNER JOIN tm_product_actived product_active
          ON product_active.serial_id = product_truck.serial_id
          AND product_active.serial_no = product_truck.serial_no
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

    if (product.is_close === "Y") {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ success: false, message: "ใบรถกระจายนี้ปิดบรรทุกแล้ว ไม่สามารถนำสินค้าออกได้" });
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

    await connection.query(`DELETE FROM tm_truck_details WHERE truck_load_id = ? AND serial_no = ?
      AND EXISTS (SELECT 1 FROM tm_product_actived product_active
        WHERE product_active.serial_id = tm_truck_details.serial_id
          AND product_active.serial_no = tm_truck_details.serial_no)`, [truckLoadId, serialNo]);
    await connection.query(`DELETE FROM tm_product_trucks WHERE id = ?`, [product.id]);

    await insertProductWarehouseLog(connection, {
      product_warehouse_id: warehouseResult.insertId,
      serial_id: product.serial_id,
      serial_no: product.serial_no,
      event_type: "RETURN_WH",
      now_warehouse_id: product.warehouse_id,
      to_warehouse_id: product.to_warehouse_id,
      created_by: actorId,
      created_date: now,
    });

    await insertProductTruckLog(connection, {
      product_truck_id: product.id,
      serial_id: product.serial_id,
      serial_no: product.serial_no,
      event_type: "UNLOAD_DT",
      created_by: actorId,
      user_truck_id: product.user_truck_id,
      driver_name: product.driver_name,
      truck_id: product.truck_id,
      status: product.status,
      truck_load_id: truckLoadId,
      is_dc_mismatch: "N",
      parcel_to_warehouse_id: product.to_warehouse_id,
      truck_to_warehouse_id: null,
      created_date: now,
    });

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

export const createDriverDeliveryTruck = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const driverId = getActorId(req);
    const warehouseId = getWarehouseId(req);
    const routeId = toNumberOrNull(req.body.route_id);
    const vehicleId = toNumberOrNull(req.body.vehicle_id);

    if (!driverId || !warehouseId || !routeId) {
      return res.status(400).json({ success: false, message: "ข้อมูลผู้ขับรถ คลัง หรือสายรถไม่ถูกต้อง" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [driverRows] = await connection.query(
      `
        SELECT id, role_id, first_name, last_name, COALESCE(employment_type, 'EMPLOYEE') AS employment_type
        FROM um_users
        WHERE id = ?
          AND role_id IN (1, 7)
          AND COALESCE(is_active, 1) = 1
        LIMIT 1
        FOR UPDATE
      `,
      [driverId],
    );
    const driver = driverRows[0];

    if (!driver) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(403).json({ success: false, message: "บัญชีนี้ไม่มีสิทธิ์สร้างใบรถในฐานะคนขับ" });
    }

    const driverType = Number(driver.role_id) === 1 ? "EMPLOYEE" : driver.employment_type === "CONTRACTOR" ? "CONTRACTOR" : "EMPLOYEE";
    if (driverType === "EMPLOYEE" && !vehicleId) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(400).json({ success: false, message: "กรุณาเลือกรถ" });
    }

    const [vehicleRows] = await connection.query(
      driverType === "CONTRACTOR"
        ? `
            SELECT id
            FROM mm_vehicles_contractor
            WHERE user_truck_id = ?
              AND is_deleted = 'N'
            ORDER BY id
            LIMIT 2
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
      driverType === "CONTRACTOR" ? [driverId] : [vehicleId],
    );

    if (!vehicleRows.length || (driverType === "CONTRACTOR" && vehicleRows.length !== 1)) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({
        success: false,
        message: driverType === "CONTRACTOR" ? "ไม่พบรถที่ผูกกับคนขับเพียงหนึ่งคัน" : "ไม่พบรถที่เลือกหรือรถไม่พร้อมใช้งาน",
      });
    }

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

    if (!routeRows.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(400).json({ success: false, message: "ไม่พบสายรถที่เลือกในคลังของคุณ" });
    }

    const now = new Date();
    const truckCode = await createTemporaryTruckCode(connection, now);
    const driverName = [driver.first_name, driver.last_name].filter(Boolean).join(" ") || null;
    const contractorVehicleId = driverType === "CONTRACTOR" ? vehicleRows[0].id : null;

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
        driverId,
        driverId,
        driverType,
        driverName,
        driverType === "EMPLOYEE" ? vehicleId : null,
        contractorVehicleId,
        warehouseId,
        routeId,
        cleanText(req.body.note),
      ],
    );

    await syncTruckBoxCount(connection, result.insertId);
    await connection.commit();
    transactionStarted = false;

    return res.status(201).json({
      success: true,
      message: "สร้างใบรถกระจายสำเร็จ",
      data: { truck_load_id: result.insertId, truck_code: truckCode },
    });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    console.error("createDriverDeliveryTruck error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถสร้างใบรถกระจายได้" });
  } finally {
    connection?.release();
  }
};

