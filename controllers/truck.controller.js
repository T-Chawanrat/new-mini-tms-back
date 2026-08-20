// server/controllers/truck.controller.js

import { randomInt } from "crypto";

import db from "../config/db.js";
import {
  cleanCode,
  cleanDbText,
  toNumberOrNull,
} from "../utils/cleanText.js";
import { getPagination } from "../utils/pagination.js";
import { cleanYN, syncTruckBoxCount } from "../utils/truckUtils.js";

const createTruckCode = async (connection, now) => {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const getPart = (type) => dateParts.find((part) => part.type === type)?.value || "";
  const temporaryTruckCodeDate = `${getPart("year")}${getPart("month")}${getPart("day")}`;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const randomNumber = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const temporaryTruckCode = `${temporaryTruckCodeDate}-${randomNumber}`;

    const [existingRows] = await connection.query(
      `
        SELECT 1
        FROM tm_trucks
        WHERE truck_code = ?
        LIMIT 1
      `,
      [temporaryTruckCode],
    );

    if (!existingRows.length) {
      return temporaryTruckCode;
    }
  }

  throw new Error("unable to generate unique truck_code");
};

const TRUCK_SELECT_FIELDS = `
  t.id AS truck_load_id,
  t.truck_code,
  t.create_date,
  t.user_truck_id,
  t.driver_type,
  t.vehicle_id,
  t.vehicle_contractor_id,
  COALESCE(vehicle.license_plate_province_id, contractor_vehicle.license_plate_province_id) AS license_plate_province_id,
  t.status,
  t.warehouse_id,
  t.to_warehouse_id,
  t.job_id,
  t.is_close,
  t.is_completed,
  t.is_go,
  t.close_datetime,
  t.go_datetime,
  t.close_by,
  t.go_by,
  t.is_arrived,
  t.arrived_by,
  t.arrived_datetime,
  t.note,
  t.sub_warehouse,
  COALESCE(
    truck_count.count_box,
    (SELECT COUNT(*) FROM tm_truck_details detail_count WHERE detail_count.truck_load_id = t.id),
    0
  ) AS count_box,

  warehouse_from.warehouse_name AS warehouse_name,
  warehouse_to.warehouse_name AS to_warehouse_name,

  driver.employee_code,
  driver.tel,
  COALESCE(
    NULLIF(CONCAT_WS(' ', NULLIF(driver.first_name, ''), NULLIF(driver.last_name, '')), ''),
    t.driver_name
  ) AS driver_name,
  NULLIF(
    TRIM(CONCAT_WS(' ', NULLIF(closer.first_name, ''), NULLIF(closer.last_name, ''))),
    ''
  ) AS closed_by_name,

  COALESCE(vehicle.license_plate, contractor_vehicle.license_plate) AS license_plate,
  COALESCE(vehicle.license_plate_province, contractor_plate_province.province_name) AS license_province,
  COALESCE(vehicle.model, contractor_vehicle.model) AS model,
  COALESCE(
    truck_count.count_box,
    (SELECT COUNT(*) FROM tm_truck_details detail_count WHERE detail_count.truck_load_id = t.id),
    0
  ) AS serial_count
`;

const TRUCK_FROM_JOINS = `
  FROM tm_trucks t
  LEFT JOIN mm_warehouses_to warehouse_from
    ON warehouse_from.warehouse_id = t.warehouse_id
  LEFT JOIN mm_warehouses_to warehouse_to
    ON warehouse_to.warehouse_id = t.to_warehouse_id
  LEFT JOIN um_users driver
    ON driver.id = t.user_truck_id
  LEFT JOIN um_users closer
    ON closer.id = t.close_by
  LEFT JOIN mm_vehicles vehicle
    ON vehicle.id = t.vehicle_id
  LEFT JOIN mm_vehicles_contractor contractor_vehicle
    ON contractor_vehicle.id = t.vehicle_contractor_id
  LEFT JOIN mm_province plate_province
    ON plate_province.id = vehicle.license_plate_province_id
  LEFT JOIN mm_province contractor_plate_province
    ON contractor_plate_province.id = contractor_vehicle.license_plate_province_id
  LEFT JOIN tm_truck_count truck_count
    ON truck_count.truck_load_id = t.id
`;

const getTruckLoadRow = async (connection, truckLoadId) => {
  const [rows] = await connection.query(
    `
      SELECT
        ${TRUCK_SELECT_FIELDS}
      ${TRUCK_FROM_JOINS}
      WHERE t.id = ?
        AND COALESCE(t.is_deleted, 'N') = 'N'
      LIMIT 1
    `,
    [truckLoadId],
  );

  return rows[0] || null;
};

const writeTruckTransactions = async ({ connection, truckLoadId, actorId, statusId, statusMessage, now }) => {
  const dataYear = now.getFullYear();
  const dataYearmonth = dataYear * 100 + now.getMonth() + 1;
  await connection.query(
    `
      INSERT INTO tm_product_transactions (
        receive_business_id,
        receive_walkin_id,
        receive_code,
        serial_id,
        serial_no,
        status_message,
        status_id,
        datetime,
        update_date,
        type,
        warehouse_id,
        created_by,
        latitude,
        longitude,
        warehouse_name,
        address,
        province_name,
        district_name,
        subdistrict_name,
        zip_code,
        created_name,
        username,
        truck_license_plate,
        user_id,
        user_truck_id,
        truck_name,
        truck_id,
        vehicle_contractor_id,
        truck_province,
        note,
        data_year,
        data_yearmonth
      )
      SELECT
        transaction_last.receive_business_id,
        transaction_last.receive_walkin_id,
        transaction_last.receive_code,
        transaction_last.serial_id,
        transaction_last.serial_no,
        ?,
        ?,
        ?,
        NULL,
        'PUBLIC',
        truck.warehouse_id,
        actor.id,
        transaction_last.latitude,
        transaction_last.longitude,
        warehouse.warehouse_name,
        transaction_last.address,
        transaction_last.province_name,
        transaction_last.district_name,
        transaction_last.subdistrict_name,
        transaction_last.zip_code,
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
        ?,
        ?
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

export const getTruckLoads = async (req, res) => {
  try {
    const warehouseId = Number(req.user?.warehouse_id);

    if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
      return res.status(401).json({
        success: false,
        message: "ไม่พบ Warehouse ที่เลือก",
      });
    }

    const {
      truck_code,
      create_date_from,
      create_date_to,
      is_close,
      is_go,
      is_completed,
      is_arrived,
    } = req.query;

    const { page, limit, offset } = getPagination(req.query.page, req.query.limit);
    const conditions = [
      "COALESCE(t.is_deleted, 'N') = 'N'",
      "COALESCE(t.is_arrived, 'N') <> 'Y'",
      "t.warehouse_id = ?",
      "t.status = 'DC_TRUCK_DC'",
    ];
    const params = [warehouseId];
    const search = cleanCode(truck_code);

    if (search) {
      conditions.push("t.truck_code LIKE ?");
      params.push(`%${search}%`);
    }

    if (create_date_from) {
      conditions.push("DATE(t.create_date) >= ?");
      params.push(create_date_from);
    }

    if (create_date_to) {
      conditions.push("DATE(t.create_date) <= ?");
      params.push(create_date_to);
    }

    const flagFilters = [
      ["t.is_close", cleanYN(is_close)],
      ["t.is_go", cleanYN(is_go)],
      ["t.is_completed", cleanYN(is_completed)],
      ["t.is_arrived", cleanYN(is_arrived)],
    ];

    for (const [column, value] of flagFilters) {
      if (value) {
        conditions.push(`${column} = ?`);
        params.push(value);
      }
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const [countRows] = await db.query(
      `
        SELECT COUNT(*) AS total
        FROM tm_trucks t
        ${whereClause}
      `,
      params,
    );

    const total = Number(countRows[0]?.total || 0);
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    const [rows] = await db.query(
      `
        SELECT
          ${TRUCK_SELECT_FIELDS}
        ${TRUCK_FROM_JOINS}
        ${whereClause}
        ORDER BY t.create_date DESC, t.id DESC
        LIMIT ? OFFSET ?
      `,
      [...params, limit, offset],
    );

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
    });
  } catch (error) {
    console.error("getTruckLoads error:", error);

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถโหลดรายการใบปิดบรรทุกได้",
    });
  }
};

export const getTruckLoadDrivers = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        id,
        id AS user_id,
        employee_code,
        first_name,
        last_name
      FROM um_users
      WHERE role_id = 7
        AND COALESCE(employment_type, 'EMPLOYEE') = 'EMPLOYEE'
        AND COALESCE(is_active, 1) = 1
      ORDER BY first_name ASC, last_name ASC, employee_code ASC
    `);

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("getTruckLoadDrivers error:", error);

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถโหลดข้อมูลพนักงานขับรถได้",
    });
  }
};

export const getTruckLoadById = async (req, res) => {
  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);

    if (!truckLoadId) {
      return res.status(400).json({
        success: false,
        message: "truck_load_id ไม่ถูกต้อง",
      });
    }

    const row = await getTruckLoadRow(db, truckLoadId);

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบใบปิดบรรทุก",
      });
    }

    return res.status(200).json({
      success: true,
      data: row,
    });
  } catch (error) {
    console.error("getTruckLoadById error:", error);

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถโหลดข้อมูลใบปิดบรรทุกได้",
    });
  }
};

export const getTruckLoadProducts = async (req, res) => {
  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);

    if (!truckLoadId) {
      return res.status(400).json({
        success: false,
        message: "truck_load_id ไม่ถูกต้อง",
      });
    }

    const truckLoad = await getTruckLoadRow(db, truckLoadId);

    if (!truckLoad) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบใบปิดบรรทุก",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
        pw.id AS product_warehouse_id,
        pw.serial_id,
        pw.serial_no,
        pw.now_warehouse_id AS warehouse_id,
        pw.to_warehouse_id,
        pw.resend_date,
        pw.created_date,

        rs.customer_id,
        customer.name AS customer_name,
        warehouse_to.warehouse_name AS to_warehouse_name

      FROM tm_product_warehouses pw
      INNER JOIN tm_product_actived product_active
        ON product_active.serial_id = pw.serial_id
        AND product_active.serial_no = pw.serial_no
      LEFT JOIN (
        SELECT
          serial_id,
          MAX(serial_no) AS serial_no,
          MAX(customer_id) AS customer_id,
          MAX(to_warehouse_id) AS to_warehouse_id
        FROM tm_receive_serials
        GROUP BY serial_id
      ) rs
        ON rs.serial_id = pw.serial_id
      LEFT JOIN mm_customers customer
        ON customer.id = rs.customer_id
      LEFT JOIN mm_warehouses_to warehouse_to
        ON warehouse_to.warehouse_id = pw.to_warehouse_id
      LEFT JOIN tm_product_trucks active_truck
        ON active_truck.serial_id = pw.serial_id
        AND active_truck.status IN ('LOADED', 'DELIVERING')
      WHERE NULLIF(TRIM(pw.serial_no), '') IS NOT NULL
        AND pw.now_warehouse_id = ?
        AND pw.to_warehouse_id = ?
        AND pw.now_warehouse_id <> pw.to_warehouse_id
        AND active_truck.id IS NULL
      ORDER BY pw.id ASC
    `,
      [truckLoad.warehouse_id, truckLoad.to_warehouse_id],
    );

    const [loadedRows] = await db.query(
      `
        SELECT
          pt.serial_id,
          pt.serial_no,
          rs.customer_id,
          customer.name AS customer_name,
          rs.to_warehouse_id,
          warehouse_to.warehouse_name AS to_warehouse_name
        FROM tm_product_trucks pt
        LEFT JOIN (
          SELECT
            serial_id,
            MAX(customer_id) AS customer_id,
            MAX(to_warehouse_id) AS to_warehouse_id
          FROM tm_receive_serials
          GROUP BY serial_id
        ) rs
          ON rs.serial_id = pt.serial_id
        LEFT JOIN mm_customers customer
          ON customer.id = rs.customer_id
        LEFT JOIN mm_warehouses_to warehouse_to
          ON warehouse_to.warehouse_id = rs.to_warehouse_id
        WHERE pt.truck_load_id = ?
          AND pt.status IN ('LOADED', 'DELIVERING')
        ORDER BY pt.id DESC
      `,
      [truckLoadId],
    );

    return res.status(200).json({
      success: true,
      truck: truckLoad,
      total: rows.length,
      data: rows,
      loaded: loadedRows,
    });
  } catch (error) {
    console.error("getTruckLoadProducts error:", error);

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถโหลดรายการสินค้าในคลังได้",
    });
  }
};

export const loadTruckProduct = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const requestedSerialId = cleanCode(req.body.serial_id);
    const requestedSerialNo = cleanCode(req.body.serial_no);
    const confirmDestinationMismatch = req.body.confirm_destination_mismatch === true;
    const actorId = toNumberOrNull(req.user?.id ?? req.user?.user_id);

    if (!truckLoadId || !actorId || (!requestedSerialId && !requestedSerialNo)) {
      return res.status(400).json({
        success: false,
        message: "truck_load_id หรือ Serial No ไม่ถูกต้อง",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const now = new Date();

    const truckLoad = await getTruckLoadRow(connection, truckLoadId);

    if (!truckLoad) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ success: false, message: "ไม่พบใบปิดบรรทุก" });
    }

    if (truckLoad.is_close === "Y") {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ success: false, message: "ใบปิดบรรทุกนี้ปิดบรรทุกแล้ว ไม่สามารถเพิ่มสินค้าได้" });
    }

    const [warehouseRows] = await connection.query(
      `
        SELECT
          pw.id AS product_warehouse_id,
          pw.serial_id,
          pw.serial_no,
          pw.now_warehouse_id,
          pw.to_warehouse_id,
          pw.resend_date,
          rs.customer_id,
          customer.name AS customer_name,
          warehouse_to.warehouse_name AS to_warehouse_name
        FROM tm_product_warehouses pw
        INNER JOIN tm_product_actived product_active
          ON product_active.serial_id = pw.serial_id
          AND product_active.serial_no = pw.serial_no
        LEFT JOIN tm_receive_serials rs
          ON rs.serial_id = pw.serial_id
          AND rs.serial_no = pw.serial_no
        LEFT JOIN mm_customers customer
          ON customer.id = rs.customer_id
        LEFT JOIN mm_warehouses_to warehouse_to
          ON warehouse_to.warehouse_id = pw.to_warehouse_id
        WHERE pw.now_warehouse_id = ?
          AND (? IS NULL OR product_active.serial_id = ?)
          AND (? IS NULL OR product_active.serial_no = ?)
        ORDER BY pw.id DESC
        LIMIT 1
      `,
      [
        truckLoad.warehouse_id,
        requestedSerialId,
        requestedSerialId,
        requestedSerialNo,
        requestedSerialNo,
      ],
    );

    const product = warehouseRows[0];

    if (!product) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ success: false, message: "ไม่พบ Serial No ในคลังต้นทาง" });
    }

    if (Number(product.now_warehouse_id) === Number(product.to_warehouse_id)) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({
        success: false,
        message: "พัสดุอยู่ที่ DC ปลายทางแล้ว ไม่สามารถยิงขึ้นรถได้",
      });
    }

    const destinationMatches = Number(product.to_warehouse_id) === Number(truckLoad.to_warehouse_id);

    if (!destinationMatches && !confirmDestinationMismatch) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({
        success: false,
        code: "DESTINATION_MISMATCH",
        message: "ของชิ้นนี้ปลายทางไม่ใช่ DC ที่เลือก",
        data: product,
      });
    }

    const [activeRows] = await connection.query(
      `
        SELECT id
        FROM tm_product_trucks
        WHERE serial_id = ?
          AND status IN ('LOADED', 'DELIVERING')
        LIMIT 1
      `,
      [product.serial_id],
    );

    if (activeRows.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ success: false, message: "Serial No นี้ถูกยิงขึ้นรถแล้ว" });
    }

    const [productTruckResult] = await connection.query(
      `
        INSERT INTO tm_product_trucks (
          serial_id,
          serial_no,
          user_truck_id,
          driver_name,
          truck_id,
          status,
          resend_date,
          truck_load_id,
          created_by,
          created_date
        )
        VALUES (?, ?, ?, ?, ?, 'LOADED', ?, ?, ?, ?)
      `,
      [
        product.serial_id,
        product.serial_no,
        truckLoad.user_truck_id,
        truckLoad.driver_name,
        truckLoad.vehicle_id ?? truckLoad.vehicle_contractor_id,
        product.resend_date,
        truckLoadId,
        actorId,
        now,
      ],
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
        VALUES (?, ?, ?, 'LOAD', ?, ?, ?, ?, ?, ?, 'LOADED', ?, ?, ?, ?, ?)
      `,
      [
        productTruckResult.insertId,
        product.serial_id,
        product.serial_no,
        actorId,
        truckLoad.user_truck_id,
        truckLoad.driver_name,
        truckLoad.vehicle_id ?? truckLoad.vehicle_contractor_id,
        truckLoad.license_plate,
        truckLoad.license_plate_province_id,
        truckLoadId,
        destinationMatches ? "N" : "Y",
        product.to_warehouse_id,
        truckLoad.to_warehouse_id,
        now,
      ],
    );

    await connection.query(
      `
        INSERT INTO logs_product_warehouses (
          product_warehouse_id, serial_id, serial_no, event_type,
          now_warehouse_id, to_warehouse_id, created_by, created_date
        )
        VALUES (?, ?, ?, 'TRUCK_OUT', ?, ?, ?, ?)
      `,
      [
        product.product_warehouse_id,
        product.serial_id,
        product.serial_no,
        truckLoad.warehouse_id,
        product.to_warehouse_id,
        actorId,
        now,
      ],
    );

    await connection.query(
      `
        INSERT INTO tm_truck_details (
          truck_load_id,
          serial_id,
          serial_no,
          create_date,
          is_receive
        )
        VALUES (?, ?, ?, ?, 'N')
      `,
      [truckLoadId, product.serial_id, product.serial_no, now],
    );

    await connection.query(
      `
        DELETE FROM tm_product_warehouses
        WHERE serial_id = ?
          AND serial_no = ?
          AND now_warehouse_id = ?
        LIMIT 1
      `,
      [product.serial_id, product.serial_no, truckLoad.warehouse_id],
    );

    await syncTruckBoxCount(connection, truckLoadId);

    await connection.commit();
    transactionStarted = false;

    return res.status(201).json({
      success: true,
      message: `ยิง SN ${product.serial_no} ขึ้นรถสำเร็จ`,
      data: product,
    });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    console.error("loadTruckProduct error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถยิงสินค้าขึ้นรถได้" });
  } finally {
    connection?.release();
  }
};

export const closeAndGoTruckLoad = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const actorId = toNumberOrNull(req.user?.id ?? req.user?.user_id);

    if (!truckLoadId || !actorId) {
      return res.status(400).json({ success: false, message: "ข้อมูลใบปิดบรรทุกไม่ถูกต้อง" });
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
          AND COALESCE(truck.is_deleted, 'N') = 'N'
        LIMIT 1
        FOR UPDATE
      `,
      [truckLoadId],
    );

    if (!rows.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ success: false, message: "ไม่พบใบปิดบรรทุก" });
    }

    if (rows[0].is_close === "Y" && rows[0].is_go === "Y") {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ success: false, message: "ใบนี้ปิดบรรทุกและปล่อยรถแล้ว" });
    }

    if (Number(rows[0].serial_count || 0) <= 0) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ success: false, message: "ใบปิดบรรทุกยังไม่มี Serial No" });
    }

    await connection.query(
      `
        UPDATE tm_trucks
        SET
          truck_code = CASE
            WHEN truck_code LIKE 'TK-%' THEN truck_code
            ELSE CONCAT('TK-', truck_code)
          END,
          close_by = COALESCE(close_by, ?),
          close_datetime = COALESCE(close_datetime, ?),
          go_by = COALESCE(go_by, ?),
          go_datetime = COALESCE(go_datetime, ?),
          is_close = 'Y',
          is_go = 'Y'
        WHERE id = ?
      `,
      [actorId, now, actorId, now, truckLoadId],
    );
    await connection.query(
      `UPDATE tm_product_trucks SET status = 'DELIVERING' WHERE truck_load_id = ? AND status = 'LOADED'`,
      [truckLoadId],
    );
    if (rows[0].is_close !== "Y") {
      await writeTruckTransactions({
        connection,
        truckLoadId,
        actorId,
        statusId: 8,
        statusMessage: "ปิดบรรทุก",
        now,
      });
    }
    if (rows[0].is_go !== "Y") {
      await writeTruckTransactions({
        connection,
        truckLoadId,
        actorId,
        statusId: 5,
        statusMessage: "พัสดุออกจากศูนย์",
        now,
      });
    }

    const data = await getTruckLoadRow(connection, truckLoadId);
    await connection.commit();
    transactionStarted = false;

    return res.status(200).json({ success: true, message: "ปิดบรรทุกและปล่อยรถสำเร็จ", data });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    console.error("closeAndGoTruckLoad error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถปิดบรรทุกและปล่อยรถได้" });
  } finally {
    connection?.release();
  }
};

export const getTruckLoadPrint = async (req, res) => {
  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);

    if (!truckLoadId) {
      return res.status(400).json({ success: false, message: "truck_load_id ไม่ถูกต้อง" });
    }

    const truck = await getTruckLoadRow(db, truckLoadId);

    if (!truck) {
      return res.status(404).json({ success: false, message: "ไม่พบใบปิดบรรทุก" });
    }

    if (truck.is_close !== "Y" || Number(truck.serial_count || 0) <= 0) {
      return res.status(409).json({ success: false, message: "ต้องมี Serial No และปิดบรรทุกก่อนพิมพ์" });
    }

    const [items] = await db.query(
      `
        SELECT
          MIN(detail.id) AS id,
          MIN(detail.serial_id) AS serial_id,
          MIN(detail.serial_no) AS serial_no,
          MAX(detail.create_date) AS create_date,
          MAX(receive_data.receive_code) AS receive_code,
          MAX(customer.name) AS customer_name,
          MAX(receive_data.recipient_name) AS recipient_name,
          COUNT(DISTINCT detail.serial_no) AS qty
        FROM tm_truck_details detail
        LEFT JOIN (
          SELECT
            serial_id,
            MAX(receive_code) AS receive_code,
            MAX(customer_id) AS customer_id,
            MAX(to_warehouse_id) AS to_warehouse_id,
            MAX(recipient_name) AS recipient_name,
            MAX(tel) AS tel,
            MAX(address) AS address,
            MAX(subdistrict_name) AS subdistrict_name,
            MAX(district_name) AS district_name,
            MAX(province_name) AS province_name,
            MAX(zip_code) AS zip_code,
            MAX(cost) AS cost,
            MAX(weight) AS weight,
            MAX(q) AS qty
          FROM tm_receive_serials
          GROUP BY serial_id
        ) receive_data
          ON receive_data.serial_id = detail.serial_id
        LEFT JOIN mm_customers customer
          ON customer.id = receive_data.customer_id
        WHERE detail.truck_load_id = ?
        GROUP BY receive_data.receive_code
        ORDER BY MIN(detail.id) ASC
      `,
      [truckLoadId],
    );

    return res.status(200).json({ success: true, data: { truck, items } });
  } catch (error) {
    console.error("getTruckLoadPrint error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดข้อมูลสำหรับพิมพ์ได้" });
  }
};

export const unloadTruckProduct = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const serialNo = cleanCode(req.body.serial_no);
    const actorId = toNumberOrNull(req.user?.id ?? req.user?.user_id);

    if (!truckLoadId || !serialNo || !actorId) {
      return res.status(400).json({ success: false, message: "ข้อมูลไม่ถูกต้อง" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const now = new Date();

    const [productRows] = await connection.query(
      `
        SELECT
          product_truck.id,
          product_truck.serial_id,
          product_truck.serial_no,
          product_truck.user_truck_id,
          COALESCE(product_truck.driver_name, truck.driver_name) AS driver_name,
          COALESCE(product_truck.truck_id, truck.vehicle_contractor_id) AS truck_id,
          COALESCE(vehicle.license_plate, contractor_vehicle.license_plate) AS truck_license_plate,
          COALESCE(vehicle.license_plate_province_id, contractor_vehicle.license_plate_province_id) AS license_plate_province_id,
          product_truck.status,
          product_truck.truck_load_id,
          product_warehouse.resend_date,
          COALESCE(product_warehouse.to_warehouse_id, receive_serial.to_warehouse_id, truck.to_warehouse_id) AS restore_to_warehouse_id,
          COALESCE(product_warehouse.to_warehouse_id, receive_serial.to_warehouse_id) AS parcel_to_warehouse_id,
          truck.to_warehouse_id AS truck_to_warehouse_id
          ,truck.warehouse_id AS from_warehouse_id
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        LEFT JOIN mm_vehicles vehicle
          ON vehicle.id = product_truck.truck_id
        LEFT JOIN mm_vehicles_contractor contractor_vehicle
          ON contractor_vehicle.id = truck.vehicle_contractor_id
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_truck.serial_id
          AND receive_serial.serial_no = product_truck.serial_no
        LEFT JOIN tm_product_warehouses product_warehouse
          ON product_warehouse.serial_id = product_truck.serial_id
          AND product_warehouse.serial_no = product_truck.serial_no
        WHERE product_truck.truck_load_id = ?
          AND product_truck.serial_no = ?
          AND product_truck.status IN ('LOADED', 'DELIVERING')
        ORDER BY product_warehouse.id DESC
        LIMIT 1
        FOR UPDATE
      `,
      [truckLoadId, serialNo],
    );

    if (!productRows.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ success: false, message: "ไม่พบรายการที่รอยิงกลับ" });
    }

    const productTruck = productRows[0];
    const isDcMismatch =
      productTruck.parcel_to_warehouse_id !== null &&
      productTruck.truck_to_warehouse_id !== null &&
      Number(productTruck.parcel_to_warehouse_id) !== Number(productTruck.truck_to_warehouse_id)
        ? "Y"
        : "N";

    const [restoredWarehouseResult] = await connection.query(
      `
        INSERT INTO tm_product_warehouses (
          serial_id,
          serial_no,
          now_warehouse_id,
          to_warehouse_id,
          resend_date,
          created_by,
          created_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        productTruck.serial_id,
        productTruck.serial_no,
        productTruck.from_warehouse_id,
        productTruck.restore_to_warehouse_id || productTruck.truck_to_warehouse_id,
        productTruck.resend_date || null,
        actorId,
        now,
      ],
    );

    await connection.query(
      `
        INSERT INTO logs_product_warehouses (
          product_warehouse_id,
          serial_id,
          serial_no,
          event_type,
          now_warehouse_id,
          to_warehouse_id,
          created_by,
          created_date
        )
        VALUES (?, ?, ?, 'RECEIVE_IN', ?, ?, ?, ?)
      `,
      [
        restoredWarehouseResult.insertId,
        productTruck.serial_id,
        productTruck.serial_no,
        productTruck.from_warehouse_id,
        productTruck.restore_to_warehouse_id || productTruck.truck_to_warehouse_id,
        actorId,
        now,
      ],
    );

    await connection.query(
      `DELETE FROM tm_truck_details WHERE truck_load_id = ? AND serial_no = ?`,
      [truckLoadId, serialNo],
    );
    await connection.query(
      `DELETE FROM tm_product_trucks WHERE id = ?`,
      [productTruck.id],
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
        VALUES (?, ?, ?, 'UNLOAD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        productTruck.id,
        productTruck.serial_id,
        productTruck.serial_no,
        actorId,
        productTruck.user_truck_id,
        productTruck.driver_name,
        productTruck.truck_id,
        productTruck.truck_license_plate,
        productTruck.license_plate_province_id,
        productTruck.status,
        productTruck.truck_load_id,
        isDcMismatch,
        productTruck.parcel_to_warehouse_id,
        productTruck.truck_to_warehouse_id,
        now,
      ],
    );

    await syncTruckBoxCount(connection, truckLoadId);

    await connection.commit();
    transactionStarted = false;
    return res.status(200).json({ success: true, message: `นำ SN ${serialNo} กลับรายการรอยิงแล้ว` });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    console.error("unloadTruckProduct error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถนำสินค้าออกจากรถได้" });
  } finally {
    connection?.release();
  }
};

export const deleteTruckLoad = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const actorId = toNumberOrNull(req.user?.id ?? req.user?.user_id);

    if (!truckLoadId || !actorId) {
      return res.status(400).json({ success: false, message: "ข้อมูลใบปิดบรรทุกไม่ถูกต้อง" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const now = new Date();

    const [truckRows] = await connection.query(
      `
        SELECT id
        FROM tm_trucks
        WHERE id = ?
          AND COALESCE(is_deleted, 'N') = 'N'
        LIMIT 1
        FOR UPDATE
      `,
      [truckLoadId],
    );

    if (!truckRows.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ success: false, message: "ไม่พบใบปิดบรรทุก หรือใบนี้ถูกลบแล้ว" });
    }

    await connection.query(
      `
        INSERT INTO tm_product_warehouses (
          serial_id,
          serial_no,
          now_warehouse_id,
          to_warehouse_id,
          created_by,
          created_date
        )
        SELECT
          product_truck.serial_id,
          product_truck.serial_no,
          truck.warehouse_id,
          COALESCE(receive_serial.to_warehouse_id, truck.to_warehouse_id),
          ?,
          ?
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_truck.serial_id
          AND receive_serial.serial_no = product_truck.serial_no
        WHERE product_truck.truck_load_id = ?
      `,
      [actorId, now, truckLoadId],
    );

    await connection.query(
      `
        INSERT INTO logs_product_warehouses (
          product_warehouse_id,
          serial_id,
          serial_no,
          event_type,
          now_warehouse_id,
          to_warehouse_id,
          created_by,
          created_date
        )
        SELECT
          product_warehouse.id,
          product_warehouse.serial_id,
          product_warehouse.serial_no,
          'CANCEL_RETURN',
          product_warehouse.now_warehouse_id,
          product_warehouse.to_warehouse_id,
          ?,
          ?
        FROM tm_product_warehouses product_warehouse
        INNER JOIN tm_product_trucks product_truck
          ON product_truck.serial_id = product_warehouse.serial_id
          AND product_truck.serial_no = product_warehouse.serial_no
        WHERE product_truck.truck_load_id = ?
      `,
      [actorId, now, truckLoadId],
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
          'CANCEL',
          ?,
          product_truck.user_truck_id,
          COALESCE(product_truck.driver_name, truck.driver_name),
          COALESCE(product_truck.truck_id, truck.vehicle_contractor_id),
          COALESCE(vehicle.license_plate, contractor_vehicle.license_plate),
          COALESCE(vehicle.license_plate_province_id, contractor_vehicle.license_plate_province_id),
          product_truck.status,
          product_truck.truck_load_id,
          CASE
            WHEN receive_serial.to_warehouse_id IS NOT NULL
              AND truck.to_warehouse_id IS NOT NULL
              AND receive_serial.to_warehouse_id <> truck.to_warehouse_id
            THEN 'Y'
            ELSE 'N'
          END,
          receive_serial.to_warehouse_id,
          truck.to_warehouse_id,
          ?
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        LEFT JOIN mm_vehicles vehicle
          ON vehicle.id = product_truck.truck_id
        LEFT JOIN mm_vehicles_contractor contractor_vehicle
          ON contractor_vehicle.id = truck.vehicle_contractor_id
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_truck.serial_id
          AND receive_serial.serial_no = product_truck.serial_no
        LEFT JOIN tm_product_warehouses product_warehouse
          ON product_warehouse.id = (
            SELECT MAX(product_warehouse_latest.id)
            FROM tm_product_warehouses product_warehouse_latest
            WHERE product_warehouse_latest.serial_id = product_truck.serial_id
              AND product_warehouse_latest.serial_no = product_truck.serial_no
          )
        WHERE product_truck.truck_load_id = ?
      `,
      [actorId, now, truckLoadId],
    );

    await connection.query(
      `DELETE FROM tm_truck_details WHERE truck_load_id = ?`,
      [truckLoadId],
    );
    await connection.query(
      `DELETE FROM tm_product_trucks WHERE truck_load_id = ?`,
      [truckLoadId],
    );
    await syncTruckBoxCount(connection, truckLoadId);

    await connection.query(
      `
        UPDATE tm_trucks
        SET
          is_deleted = 'Y',
          deleted_by = ?
        WHERE id = ?
          AND COALESCE(is_deleted, 'N') = 'N'
      `,
      [actorId, truckLoadId],
    );

    await connection.commit();
    transactionStarted = false;

    return res.status(200).json({ success: true, message: "ลบใบปิดบรรทุกและคืนสินค้าเข้าคลังสำเร็จ" });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    console.error("deleteTruckLoad error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถลบใบปิดบรรทุกได้" });
  } finally {
    connection?.release();
  }
};

export const createTruckLoad = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const createdBy = toNumberOrNull(req.user?.id ?? req.user?.user_id);
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);
    const userTruckId = toNumberOrNull(req.body.user_truck_id);
    const vehicleId = toNumberOrNull(req.body.vehicle_id);
    const vehicleContractorId = toNumberOrNull(req.body.vehicle_contractor_id);
    const toWarehouseId = toNumberOrNull(req.body.to_warehouse_id);
    const requestedDriverType = cleanCode(req.body.driver_type ?? req.body.truck_type)?.toUpperCase();
    const driverType = requestedDriverType === "EXTRA" || requestedDriverType === "CONTRACTOR" ? "CONTRACTOR" : "EMPLOYEE";

    if (!createdBy) {
      return res.status(401).json({
        success: false,
        message: "ไม่พบข้อมูลผู้ใช้งาน",
      });
    }

    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "ผู้ใช้งานยังไม่ได้กำหนด Warehouse",
      });
    }

    if (!userTruckId) {
      return res.status(400).json({
        success: false,
        message: driverType === "CONTRACTOR" ? "กรุณาเลือกคนขับและรถเสริม" : "กรุณาเลือกพนักงานขับรถ",
      });
    }

    if (driverType === "EMPLOYEE" && !vehicleId) {
      return res.status(400).json({
        success: false,
        message: "กรุณาเลือกรถ",
      });
    }

    if (driverType === "CONTRACTOR" && !vehicleContractorId) {
      return res.status(400).json({
        success: false,
        message: "กรุณาเลือกคนขับและรถเสริม",
      });
    }

    if (!toWarehouseId) {
      return res.status(400).json({
        success: false,
        message: "กรุณาเลือก To Warehouse",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [[driverRows], [vehicleRows], [warehouseRows]] = await Promise.all([
      connection.query(
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
      ),
      connection.query(
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
        driverType === "CONTRACTOR"
          ? [vehicleContractorId, userTruckId]
          : [vehicleId],
      ),
      connection.query(
        `
          SELECT warehouse_id
          FROM mm_warehouses_to
          WHERE warehouse_id = ?
          LIMIT 1
        `,
        [toWarehouseId],
      ),
    ]);

    if (!driverRows.length) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(400).json({
        success: false,
        message: "ไม่พบข้อมูลคนขับที่เลือก",
      });
    }

    if (!vehicleRows.length) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(400).json({
        success: false,
        message: driverType === "CONTRACTOR" ? "ไม่พบข้อมูลรถเสริมที่เลือก" : "ไม่พบข้อมูลรถที่เลือก",
      });
    }

    if (!warehouseRows.length) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(400).json({
        success: false,
        message: "ไม่พบข้อมูลคลังปลายทาง",
      });
    }

    const now = new Date();
    const truckCode = await createTruckCode(connection, now);
    const driverName = [driverRows[0].first_name, driverRows[0].last_name]
      .filter(Boolean)
      .join(" ") || null;

    const [result] = await connection.query(
      `
        INSERT INTO tm_trucks (
          truck_code,
          create_date,
          created_by,
          user_truck_id,
          driver_type,
          driver_name,
          vehicle_id,
          vehicle_contractor_id,
          status,
          warehouse_id,
          to_warehouse_id,
          note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DC_TRUCK_DC', ?, ?, ?)
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
        toWarehouseId,
        cleanDbText(req.body.note),
      ],
    );

    await syncTruckBoxCount(connection, result.insertId);

    const createdRow = await getTruckLoadRow(connection, result.insertId);

    await connection.commit();
    transactionStarted = false;

    return res.status(201).json({
      success: true,
      message: "สร้างใบปิดบรรทุกสำเร็จ",
      data: createdRow,
    });
  } catch (error) {
    if (connection && transactionStarted) {
      await connection.rollback();
    }

    console.error("createTruckLoad error:", error);

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถสร้างใบปิดบรรทุกได้",
    });
  } finally {
    connection?.release();
  }
};
