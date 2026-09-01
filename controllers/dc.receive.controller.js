import db from "../config/db.js";
import { randomUUID } from "node:crypto";
import { cleanCode, toNumberOrNull } from "../utils/cleanText.js";

const cleanSerialNos = (value) =>
  Array.isArray(value)
    ? [...new Set(value.map((item) => cleanCode(item)).filter(Boolean))]
    : [];

const createDcReceiveDraft = async ({ batchId, serialNo, warehouseId, actorId }) => {
  const connection = await db.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;
    const now = new Date();

    const [productRows] = await connection.query(
      `
        SELECT
          product_truck.id AS product_truck_id,
          product_truck.truck_load_id,
          product_truck.serial_id,
          product_truck.serial_no,
          product_truck.route_id,
          truck.to_warehouse_id,
          receive_serial.to_warehouse_id AS receive_to_warehouse_id,
          receive_serial.route_id AS receive_route_id
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_truck.serial_id
          AND receive_serial.serial_no = product_truck.serial_no
        WHERE product_truck.serial_no = ?
          AND product_truck.status = 'DELIVERING'
          AND truck.to_warehouse_id = ?
          AND truck.is_close = 'Y'
          AND truck.is_go = 'Y'
          AND COALESCE(truck.is_deleted, 'N') = 'N'
        FOR UPDATE
      `,
      [serialNo, warehouseId],
    );

    if (!productRows.length) {
      await connection.rollback();
      transactionStarted = false;
      return { status: 400, message: "ไม่พบ Serial No ในรถซึ่งมาถึง DC นี้" };
    }

    const product = productRows[0];
    const [warehouseRows] = await connection.query(
      "SELECT id FROM tm_product_warehouses WHERE serial_no = ? LIMIT 1 FOR UPDATE",
      [product.serial_no],
    );

    if (warehouseRows.length) {
      await connection.rollback();
      transactionStarted = false;
      return { status: 409, message: "Serial No นี้อยู่ในคลังแล้ว" };
    }

    await connection.query(
      `
        INSERT INTO tmp_product_warehouses (
          tmp_batch_id, action_type, serial_id, serial_no,
          source_product_truck_id, source_truck_load_id, source_warehouse_id,
          now_warehouse_id, to_warehouse_id, route_id, created_by, created_date
        ) VALUES (?, 'DC_RECEIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        batchId,
        product.serial_id,
        product.serial_no,
        product.product_truck_id,
        product.truck_load_id,
        null,
        warehouseId,
        product.receive_to_warehouse_id ?? product.to_warehouse_id,
        product.route_id ?? product.receive_route_id,
        actorId,
        now,
      ],
    );

    await connection.commit();
    transactionStarted = false;
    return { status: 201, message: "เพิ่มรายการรอยืนยันแล้ว" };
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    if (error?.code === "ER_DUP_ENTRY") {
      return { status: 409, message: "Serial No นี้อยู่ในรายการรอยืนยันแล้ว" };
    }
    throw error;
  } finally {
    connection.release();
  }
};

const removeDcReceiveDraft = async ({ serialNo, warehouseId, actorId }) => {
  const [result] = await db.query(
    `
      DELETE FROM tmp_product_warehouses
      WHERE action_type = 'DC_RECEIVE'
        AND serial_no = ?
        AND created_by = ?
        AND now_warehouse_id = ?
    `,
    [serialNo, actorId, warehouseId],
  );

  if (!result.affectedRows) {
    return { status: 404, message: "ไม่พบ Serial No ในรายการรอยืนยัน" };
  }

  return { status: 200, message: "นำ SN กลับไปรายการรอยิงแล้ว" };
};

export const getDcReceiveSerials = async (req, res) => {
  try {
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);
    const actorId = toNumberOrNull(req.user?.id ?? req.user?.user_id);

    if (!warehouseId) {
      return res.status(400).json({ success: false, message: "ผู้ใช้งานยังไม่ได้กำหนดคลัง DC" });
    }

    const [rows] = await db.query(
      `
        SELECT
          product_truck.serial_id,
          product_truck.serial_no,
          product_truck.created_date AS movement_date,
          truck.id AS truck_load_id,
          truck.truck_code,
          truck.warehouse_id AS from_warehouse_id,
          warehouse_from.warehouse_name AS from_warehouse_name,
          truck.to_warehouse_id,
          warehouse_to.warehouse_name AS to_warehouse_name,
          ? AS warehouse_id,
          COALESCE(
            NULLIF(product_truck.driver_name, ''),
            NULLIF(CONCAT_WS(' ', NULLIF(driver.first_name, ''), NULLIF(driver.last_name, '')), ''),
            NULLIF(truck.driver_name, '')
          ) AS driver_name,
          vehicle.license_plate,
          vehicle.license_plate_province_id,
          vehicle.license_plate_province AS license_province
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        LEFT JOIN um_users driver
          ON driver.id = truck.user_truck_id
        LEFT JOIN mm_vehicles vehicle
          ON vehicle.id = product_truck.truck_id
        LEFT JOIN mm_warehouses_to warehouse_from
          ON warehouse_from.warehouse_id = truck.warehouse_id
        LEFT JOIN mm_warehouses_to warehouse_to
          ON warehouse_to.warehouse_id = truck.to_warehouse_id
        WHERE truck.to_warehouse_id = ?
          AND truck.is_close = 'Y'
          AND truck.is_go = 'Y'
          AND COALESCE(truck.is_deleted, 'N') = 'N'
          AND product_truck.status = 'DELIVERING'
        ORDER BY truck.truck_code ASC, product_truck.id ASC
      `,
      [warehouseId, warehouseId],
    );

    const [draftRows] = actorId
      ? await db.query(
          `
            SELECT
              temp.serial_id,
              temp.serial_no,
              temp.created_date AS movement_date,
              temp.source_truck_load_id AS truck_load_id,
              truck.truck_code,
              COALESCE(product_truck.driver_name, truck.driver_name) AS driver_name,
              vehicle.license_plate,
              province.province_name AS license_province
            FROM tmp_product_warehouses temp
            LEFT JOIN tm_trucks truck
              ON truck.id = temp.source_truck_load_id
            LEFT JOIN tm_product_trucks product_truck
              ON product_truck.id = temp.source_product_truck_id
            LEFT JOIN mm_vehicles vehicle
              ON vehicle.id = product_truck.truck_id
            LEFT JOIN mm_province province
              ON province.id = vehicle.license_plate_province_id
            WHERE temp.action_type = 'DC_RECEIVE'
              AND temp.created_by = ?
              AND temp.now_warehouse_id = ?
            ORDER BY temp.id DESC
          `,
          [actorId, warehouseId],
        )
      : [[]];

    return res.status(200).json({ success: true, total: rows.length, data: rows, draft: draftRows });
  } catch (error) {
    console.error("getDcReceiveSerials error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดรายการรอรับเข้า DC ได้" });
  }
};

export const createDcReceive = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const action = String(req.body.action ?? "").trim().toUpperCase();
    let serialNos = cleanSerialNos(req.body.serial_nos);
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);
    const actorId = toNumberOrNull(req.user?.id ?? req.user?.user_id);

    if (!warehouseId || !actorId) {
      return res.status(400).json({ success: false, message: "ข้อมูลรับสินค้าเข้า DC ไม่ถูกต้อง" });
    }

    if (action === "DRAFT") {
      const serialNo = cleanCode(req.body.serial_no);
      if (!serialNo) {
        return res.status(400).json({ success: false, message: "ข้อมูลรายการรอยืนยันไม่ถูกต้อง" });
      }

      const result = await createDcReceiveDraft({ batchId: randomUUID(), serialNo, warehouseId, actorId });
      return res.status(result.status).json({ success: result.status < 400, message: result.message });
    }

    if (action === "REMOVE") {
      const serialNo = cleanCode(req.body.serial_no);
      if (!serialNo) {
        return res.status(400).json({ success: false, message: "ข้อมูลรายการรอยืนยันไม่ถูกต้อง" });
      }

      const result = await removeDcReceiveDraft({ serialNo, warehouseId, actorId });
      return res.status(result.status).json({ success: result.status < 400, message: result.message });
    }

    if (action !== "CONFIRM" && !serialNos.length) {
      return res.status(400).json({ success: false, message: "ข้อมูลรับสินค้าเข้า DC ไม่ถูกต้อง" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const now = new Date();

    if (action === "CONFIRM") {
      const [draftRows] = await connection.query(
        `
          SELECT serial_no
          FROM tmp_product_warehouses
          WHERE action_type = 'DC_RECEIVE'
            AND created_by = ?
            AND now_warehouse_id = ?
          FOR UPDATE
        `,
        [actorId, warehouseId],
      );
      serialNos = [...new Set(draftRows.map((row) => cleanCode(row.serial_no)).filter(Boolean))];

      if (!serialNos.length) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(400).json({ success: false, message: "ยังไม่มีรายการรอยืนยัน" });
      }
    }

    const placeholders = serialNos.map(() => "?").join(", ");
    const [productRows] = await connection.query(
      `
        SELECT
          product_truck.id AS product_truck_id,
          product_truck.truck_load_id,
          product_truck.serial_id,
          product_truck.serial_no,
          truck.to_warehouse_id
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        WHERE product_truck.serial_no IN (${placeholders})
          AND product_truck.status = 'DELIVERING'
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
        INSERT INTO tm_product_warehouses (
          serial_id,
          serial_no,
          now_warehouse_id,
          to_warehouse_id,
          route_id,
          created_by,
          created_date
        )
        SELECT
          product_truck.serial_id,
          product_truck.serial_no,
          ?,
          COALESCE(receive_serial.to_warehouse_id, truck.to_warehouse_id),
          COALESCE(product_truck.route_id, receive_serial.route_id),
          ?,
          ?
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_truck.serial_id
          AND receive_serial.serial_no = product_truck.serial_no
        WHERE product_truck.serial_no IN (${placeholders})
          AND truck.to_warehouse_id = ?
          AND product_truck.status = 'DELIVERING'
      `,
      [warehouseId, actorId, now, ...serialNos, warehouseId],
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
          ?
        FROM tm_product_warehouses product_warehouse
        WHERE product_warehouse.serial_no IN (${placeholders})
      `,
      [actorId, now, ...serialNos],
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
          vehicle.license_plate,
          vehicle.license_plate_province_id,
          product_truck.status,
          product_truck.truck_load_id,
          CASE
            WHEN receive_serial.to_warehouse_id IS NOT NULL
              AND receive_serial.to_warehouse_id <> truck.to_warehouse_id
            THEN 'Y'
            ELSE 'N'
          END,
          COALESCE(receive_serial.to_warehouse_id, product_warehouse.to_warehouse_id),
          truck.to_warehouse_id,
          ?
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        LEFT JOIN mm_vehicles vehicle
          ON vehicle.id = product_truck.truck_id
        LEFT JOIN tm_receive_serials receive_serial
          ON receive_serial.serial_id = product_truck.serial_id
          AND receive_serial.serial_no = product_truck.serial_no
        INNER JOIN tm_product_warehouses product_warehouse
          ON product_warehouse.serial_id = product_truck.serial_id
          AND product_warehouse.serial_no = product_truck.serial_no
        WHERE product_truck.serial_no IN (${placeholders})
          AND truck.to_warehouse_id = ?
          AND product_truck.status = 'DELIVERING'
      `,
      [actorId, now, ...serialNos, warehouseId],
    );

    await connection.query(
      `
        UPDATE tm_truck_details detail
        INNER JOIN tm_product_trucks product_truck
          ON product_truck.truck_load_id = detail.truck_load_id
          AND product_truck.serial_id = detail.serial_id
          AND product_truck.serial_no = detail.serial_no
        SET detail.is_receive = 'Y', detail.receive_by = ?, detail.receive_date = ?
        WHERE product_truck.serial_no IN (${placeholders})
          AND product_truck.status = 'DELIVERING'
      `,
      [actorId, now, ...serialNos],
    );

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
          'พัสดุถึงศูนย์ปลายทาง', 13, ?, NULL, 'PUBLIC',
          ?, actor.id, transaction_last.latitude, transaction_last.longitude, warehouse.warehouse_name,
          transaction_last.address, transaction_last.province_name, transaction_last.district_name,
          transaction_last.subdistrict_name, transaction_last.zip_code,
          TRIM(CONCAT_WS(' ', NULLIF(actor.first_name, ''), NULLIF(actor.last_name, ''))),
          actor.username, transaction_last.truck_license_plate, actor.id, transaction_last.user_truck_id,
          transaction_last.truck_name, transaction_last.truck_id, transaction_last.vehicle_contractor_id,
          transaction_last.truck_province, transaction_last.note, ?, ?
        FROM tm_product_transactions_last transaction_last
        INNER JOIN um_users actor
          ON actor.id = ?
        LEFT JOIN mm_warehouses_to warehouse
          ON warehouse.warehouse_id = ?
        WHERE transaction_last.serial_no IN (${placeholders})
      `,
      [now, warehouseId, dataYear, dataYearmonth, actorId, warehouseId, ...serialNos],
    );

    await connection.query(
      `
        UPDATE tm_product_transactions_last transaction_last
        INNER JOIN um_users actor
          ON actor.id = ?
        LEFT JOIN mm_warehouses_to warehouse
          ON warehouse.warehouse_id = ?
        SET
          transaction_last.status_message = 'พัสดุถึงศูนย์ปลายทาง',
          transaction_last.status_id = 13,
          transaction_last.datetime = ?,
          transaction_last.update_date = ?,
          transaction_last.type = 'PUBLIC',
          transaction_last.warehouse_id = ?,
          transaction_last.created_by = actor.id,
          transaction_last.warehouse_name = warehouse.warehouse_name,
          transaction_last.created_name = TRIM(CONCAT_WS(' ', NULLIF(actor.first_name, ''), NULLIF(actor.last_name, ''))),
          transaction_last.username = actor.username,
          transaction_last.user_id = actor.id
        WHERE transaction_last.serial_no IN (${placeholders})
      `,
      [actorId, warehouseId, now, now, warehouseId, ...serialNos],
    );

    await connection.query(
      `
        DELETE product_truck
        FROM tm_product_trucks product_truck
        INNER JOIN tm_trucks truck
          ON truck.id = product_truck.truck_load_id
        WHERE serial_no IN (${placeholders})
          AND product_truck.status = 'DELIVERING'
          AND truck.to_warehouse_id = ?
      `,
      [...serialNos, warehouseId],
    );

    const truckLoadIds = [...new Set(productRows.map((row) => Number(row.truck_load_id)).filter(Number.isInteger))];

    if (truckLoadIds.length) {
      const truckPlaceholders = truckLoadIds.map(() => "?").join(", ");

      await connection.query(
        `
          UPDATE tm_trucks truck
          SET
            truck.is_arrived = 'Y',
            truck.arrived_by = ?,
            truck.arrived_datetime = ?
          WHERE truck.id IN (${truckPlaceholders})
            AND truck.to_warehouse_id = ?
            AND COALESCE(truck.is_arrived, 'N') <> 'Y'
            AND NOT EXISTS (
              SELECT 1
              FROM tm_product_trucks remaining_product
              WHERE remaining_product.truck_load_id = truck.id
                AND remaining_product.status IN ('LOADED', 'DELIVERING')
            )
        `,
        [actorId, now, ...truckLoadIds, warehouseId],
      );
    }

    if (action === "CONFIRM") {
      await connection.query(
        `
          DELETE FROM tmp_product_warehouses
          WHERE action_type = 'DC_RECEIVE'
            AND created_by = ?
            AND now_warehouse_id = ?
        `,
        [actorId, warehouseId],
      );
    }

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
