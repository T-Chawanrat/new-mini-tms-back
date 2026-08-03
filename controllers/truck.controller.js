// server/controllers/truck.controller.js

import { randomInt } from "crypto";

import db from "../config/db.js";
import {
  cleanCode,
  cleanDbText,
  toNumberOrNull,
} from "../utils/cleanText.js";
import { cleanYN, getPagination } from "../utils/truckUtils.js";

const createTruckCode = async (connection) => {
  const [dateRows] = await connection.query(`
    SELECT DATE_FORMAT(CURRENT_DATE(), '%y%m%d') AS temporary_truck_code
  `);

  const temporaryTruckCodeDate = dateRows[0].temporary_truck_code;

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
  t.truck_load_id,
  t.truck_code,
  t.create_date,
  t.customer_id,
  t.user_truck_id,
  t.driver_type,
  t.vehicle_id,
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
  t.shipper_id,
  t.recipient_id,
  t.recipient_detail_id,
  t.note,
  t.sub_warehouse,

  warehouse_from.warehouse_name AS warehouse_name,
  warehouse_to.warehouse_name AS to_warehouse_name,

  CASE
    WHEN t.driver_type = 'CONTRACTOR' THEN NULL
    ELSE driver.employee_code
  END AS employee_code,
  CASE
    WHEN t.driver_type = 'CONTRACTOR' THEN t.driver_name
    ELSE COALESCE(
      NULLIF(
        CONCAT_WS(
          ' ',
          NULLIF(driver.first_name, ''),
          NULLIF(driver.last_name, '')
        ),
        ''
      ),
      t.driver_name
    )
  END AS driver_name,

  CASE
    WHEN t.driver_type = 'CONTRACTOR' THEN t.license_plate
    ELSE COALESCE(vehicle.license_plate, t.license_plate)
  END AS license_plate,
  vehicle.license_province,
  vehicle.model
`;

const TRUCK_FROM_JOINS = `
  FROM tm_trucks t
  LEFT JOIN mm_warehouses_to warehouse_from
    ON warehouse_from.warehouse_id = t.warehouse_id
  LEFT JOIN mm_warehouses_to warehouse_to
    ON warehouse_to.warehouse_id = t.to_warehouse_id
  LEFT JOIN um_users driver
    ON driver.id = t.user_truck_id
  LEFT JOIN mm_vehicles vehicle
    ON vehicle.id = t.vehicle_id
`;

const getTruckLoadRow = async (connection, truckLoadId) => {
  const [rows] = await connection.query(
    `
      SELECT
        ${TRUCK_SELECT_FIELDS}
      ${TRUCK_FROM_JOINS}
      WHERE t.truck_load_id = ?
        AND COALESCE(t.is_deleted, 'N') = 'N'
      LIMIT 1
    `,
    [truckLoadId],
  );

  return rows[0] || null;
};

export const getTruckLoads = async (req, res) => {
  try {
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
    const conditions = ["COALESCE(t.is_deleted, 'N') = 'N'"];
    const params = [];
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
        ORDER BY t.create_date DESC, t.truck_load_id DESC
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

    const [rows] = await db.query(`
      SELECT
        pw.id AS product_warehouse_id,
        pw.serial_id,
        pw.serial_no,
        pw.warehouse_id,
        pw.dst_warehouse_id,
        pw.resend_date,
        pw.created_date,

        rs.customer_id,
        customer.name AS customer_name,
        rs.to_warehouse_id,
        warehouse_to.warehouse_name AS to_warehouse_name

      FROM tm_product_warehouses pw
      LEFT JOIN (
        SELECT
          serial_id,
          MAX(customer_id) AS customer_id,
          MAX(to_warehouse_id) AS to_warehouse_id
        FROM tm_receive_serials
        GROUP BY serial_id
      ) rs
        ON rs.serial_id = pw.serial_id
      LEFT JOIN mm_customers customer
        ON customer.id = rs.customer_id
      LEFT JOIN mm_warehouses_to warehouse_to
        ON warehouse_to.warehouse_id = rs.to_warehouse_id
      WHERE NULLIF(TRIM(pw.serial_no), '') IS NOT NULL
      ORDER BY pw.id ASC
    `);

    return res.status(200).json({
      success: true,
      truck: truckLoad,
      total: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("getTruckLoadProducts error:", error);

    return res.status(500).json({
      success: false,
      message: "ไม่สามารถโหลดรายการสินค้าในคลังได้",
    });
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
    const toWarehouseId = toNumberOrNull(req.body.to_warehouse_id);
    const requestedDriverType = cleanCode(req.body.driver_type ?? req.body.truck_type)?.toUpperCase();
    const driverType = requestedDriverType === "EXTRA" || requestedDriverType === "CONTRACTOR" ? "CONTRACTOR" : "EMPLOYEE";
    const driverName =
      cleanDbText(req.body.driver_name) ||
      [cleanDbText(req.body.driver_first_name), cleanDbText(req.body.driver_last_name)].filter(Boolean).join(" ") ||
      null;
    const licensePlate = cleanCode(req.body.license_plate);

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

    if (driverType === "EMPLOYEE" && !userTruckId) {
      return res.status(400).json({
        success: false,
        message: "กรุณาเลือกพนักงานขับรถ",
      });
    }

    if (driverType === "EMPLOYEE" && !vehicleId) {
      return res.status(400).json({
        success: false,
        message: "กรุณาเลือกรถ",
      });
    }

    if (!toWarehouseId) {
      return res.status(400).json({
        success: false,
        message: "กรุณาเลือก To Warehouse",
      });
    }

    if (driverType === "CONTRACTOR" && !driverName) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุชื่อพนักงานขับรถ",
      });
    }

    if (!licensePlate) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุทะเบียนรถ",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [[driverRows], [vehicleRows], [warehouseRows]] = await Promise.all([
      connection.query(
        `
          SELECT id
          FROM um_users
          WHERE id = ?
            AND role_id = 7
            AND COALESCE(is_active, 1) = 1
          LIMIT 1
        `,
        [userTruckId],
      ),
      connection.query(
        `
          SELECT id
          FROM mm_vehicles
          WHERE id = ?
            AND status = 'ACTIVE'
            AND is_deleted = 'N'
          LIMIT 1
        `,
        [vehicleId],
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

    if (driverType === "EMPLOYEE" && !driverRows.length) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(400).json({
        success: false,
        message: "ไม่พบข้อมูลพนักงานขับรถ",
      });
    }

    if (driverType === "EMPLOYEE" && !vehicleRows.length) {
      await connection.rollback();
      transactionStarted = false;

      return res.status(400).json({
        success: false,
        message: "ไม่พบข้อมูลรถที่เลือก",
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

    const truckCode = await createTruckCode(connection);

    const [result] = await connection.query(
      `
        INSERT INTO tm_trucks (
          truck_code,
          create_date,
          created_by,
          customer_id,
          user_truck_id,
          driver_type,
          driver_name,
          vehicle_id,
          license_plate,
          warehouse_id,
          to_warehouse_id,
          note
        )
        VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        truckCode,
        createdBy,
        toNumberOrNull(req.body.customer_id),
        userTruckId,
        driverType,
        driverName,
        vehicleId,
        licensePlate,
        warehouseId,
        toWarehouseId,
        cleanDbText(req.body.note),
      ],
    );

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
