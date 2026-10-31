import db from "../../config/db.js";
import { insertProductTruckLog, insertProductWarehouseLog } from "../../services/product-log.js";
import { deactivateContractorIfNoPendingTrucks } from "../../services/driver/driver-contractor.js";
import { saveDriverProductTransactionFromLast } from "../../services/driver/driver.product-transaction.js";
import { cleanText, toNumberOrNull } from "../../utils/input.js";
import { buildTruckVehicleSql, completeTruckIfAllReceived } from "../../utils/truck.js";

const inputError = (message, status = 400) => Object.assign(new Error(message), { status });
const truckVehicleSql = buildTruckVehicleSql();

const serialNosFrom = (value) => {
  if (!Array.isArray(value)) throw inputError("รายการ SN ไม่ถูกต้อง");
  const serialNos = [...new Set(value.map((serialNo) => cleanText(serialNo)?.slice(0, 100)).filter(Boolean))];
  if (!serialNos.length) throw inputError("กรุณาระบุ SN ที่ต้องการคืนคลัง");
  return serialNos;
};

export const getDriverFailedProducts = async (req, res) => {
  try {
    const driverId = toNumberOrNull(req.user?.id);
    if (!driverId) throw inputError("ข้อมูลผู้ขับรถไม่ถูกต้อง");

    const [products] = await db.query(
      `SELECT product.serial_id, product.serial_no, receive_serial.receive_code
       FROM tm_product_trucks product
       INNER JOIN tm_trucks truck ON truck.id = product.truck_load_id
       INNER JOIN tm_product_actived active ON active.serial_id = product.serial_id AND active.serial_no = product.serial_no
       LEFT JOIN tm_receive_serials receive_serial ON receive_serial.serial_id = product.serial_id AND receive_serial.serial_no = product.serial_no
       WHERE product.status = 'IN_TRANSIT'
         AND truck.user_truck_id = ? AND truck.status = 'DC_TRUCK' AND truck.is_close = 'Y' AND truck.is_go = 'Y'
         AND COALESCE(truck.is_deleted, 'N') = 'N'
         AND EXISTS (
           SELECT 1
           FROM logs_product_trucks truck_log
           WHERE truck_log.product_truck_id = product.id
             AND truck_log.serial_id = product.serial_id
             AND truck_log.serial_no = product.serial_no
             AND truck_log.event_type = 'DELIVERY_FAILED'
         )
       ORDER BY product.serial_no ASC`,
      [driverId],
    );
    return res.json({ success: true, data: products });
  } catch (error) {
    console.error("getDriverFailedProducts error:", error);
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "ไม่สามารถโหลดรายการส่งไม่สำเร็จได้" });
  }
};

export const returnDriverProducts = async (req, res) => {
  let connection;
  try {
    const driverId = toNumberOrNull(req.user?.id);
    const serialNos = serialNosFrom(req.body?.serial_nos);
    if (!driverId) throw inputError("ข้อมูลผู้ขับรถไม่ถูกต้อง");

    connection = await db.getConnection();
    await connection.beginTransaction();
    const now = new Date();
    const [products] = await connection.query(
      `SELECT product.id AS product_truck_id, product.truck_load_id, product.serial_id, product.serial_no,
              product.user_truck_id, COALESCE(product.driver_name, truck.driver_name) AS driver_name,
              product.truck_id, product.route_id AS parcel_route_id, product.resend_date,
              truck.warehouse_id AS return_warehouse_id, driver.warehouse_id AS current_warehouse_id,
              truck.to_warehouse_id AS truck_to_warehouse_id,
              truck.route_id AS truck_route_id, receive_serial.to_warehouse_id AS parcel_to_warehouse_id,
              ${truckVehicleSql.licensePlate} AS truck_license_plate,
              ${truckVehicleSql.licensePlateProvinceId} AS license_plate_province_id
       FROM tm_product_trucks product
       INNER JOIN tm_trucks truck ON truck.id = product.truck_load_id
       INNER JOIN um_users driver ON driver.id = truck.user_truck_id
       INNER JOIN tm_product_actived active ON active.serial_id = product.serial_id AND active.serial_no = product.serial_no
       INNER JOIN tm_receive_serials receive_serial ON receive_serial.serial_id = product.serial_id AND receive_serial.serial_no = product.serial_no
       LEFT JOIN mm_vehicles vehicle ON vehicle.id = product.truck_id
       LEFT JOIN mm_vehicles_contractor contractor_vehicle ON contractor_vehicle.id = truck.vehicle_contractor_id
       WHERE product.serial_no IN (${serialNos.map(() => "?").join(", ")})
         AND product.status = 'IN_TRANSIT'
         AND truck.user_truck_id = ? AND truck.status = 'DC_TRUCK' AND truck.is_close = 'Y' AND truck.is_go = 'Y'
         AND COALESCE(truck.is_deleted, 'N') = 'N'
       FOR UPDATE`,
      [...serialNos, driverId],
    );
    if (products.length !== serialNos.length) throw inputError("พบ SN ที่ไม่ได้อยู่ในงานนำจ่ายของคุณ", 409);

    for (const product of products) {
      const [warehouseResult] = await connection.query(
        `INSERT INTO tm_product_warehouses (
           serial_id, serial_no, now_warehouse_id, to_warehouse_id,
           route_id, resend_date, created_by, created_date
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [product.serial_id, product.serial_no, product.current_warehouse_id, product.parcel_to_warehouse_id, product.parcel_route_id, product.resend_date, driverId, now],
      );
      const [detailResult] = await connection.query(
        `UPDATE tm_truck_details
         SET is_receive = 'Y', receive_by = ?, receive_date = ?
         WHERE truck_load_id = ? AND serial_id = ? AND serial_no = ?`,
        [driverId, now, product.truck_load_id, product.serial_id, product.serial_no],
      );
      if (!detailResult.affectedRows) throw inputError(`ไม่พบรายละเอียด SN ${product.serial_no} ในใบรถ`, 409);

      await insertProductWarehouseLog(connection, {
        product_warehouse_id: warehouseResult.insertId,
        serial_id: product.serial_id,
        serial_no: product.serial_no,
        event_type: "RETURN_WH",
        now_warehouse_id: product.current_warehouse_id,
        to_warehouse_id: product.parcel_to_warehouse_id,
        created_by: driverId,
        created_date: now,
      });
      const routeMismatch = product.parcel_route_id == null || product.truck_route_id == null
        ? null
        : String(product.parcel_route_id) === String(product.truck_route_id) ? "N" : "Y";
      await insertProductTruckLog(connection, {
        product_truck_id: product.product_truck_id,
        serial_id: product.serial_id,
        serial_no: product.serial_no,
        event_type: "RETURN_WH",
        created_by: driverId,
        user_truck_id: product.user_truck_id,
        driver_name: product.driver_name,
        truck_id: product.truck_id,
        truck_license_plate: product.truck_license_plate,
        license_plate_province_id: product.license_plate_province_id,
        status: "IN_TRANSIT",
        truck_load_id: product.truck_load_id,
        is_dc_mismatch: "N",
        parcel_to_warehouse_id: product.parcel_to_warehouse_id,
        truck_to_warehouse_id: product.truck_to_warehouse_id,
        is_route_mismatch: routeMismatch,
        parcel_route_id: product.parcel_route_id,
        truck_route_id: product.truck_route_id,
        created_date: now,
      });
      await saveDriverProductTransactionFromLast({
        connection,
        serialId: product.serial_id,
        serialNo: product.serial_no,
        statusMessage: "จัดส่งไม่ได้ จัดส่งใหม่ในวันถัดไป",
        statusId: 11,
        warehouseId: product.current_warehouse_id,
        driverId,
        now,
      });
      await connection.query(`DELETE FROM tm_product_trucks WHERE id = ? AND serial_id = ? AND serial_no = ?`, [product.product_truck_id, product.serial_id, product.serial_no]);
    }

    for (const truckLoadId of new Set(products.map((product) => product.truck_load_id))) {
      await completeTruckIfAllReceived(connection, truckLoadId);
    }
    await deactivateContractorIfNoPendingTrucks(connection, driverId);
    await connection.commit();
    return res.json({ success: true, message: `คืนสินค้าเข้าคลังสำเร็จ ${products.length} SN` });
  } catch (error) {
    await connection?.rollback();
    console.error("returnDriverProducts error:", error);
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "ไม่สามารถคืนสินค้าเข้าคลังได้" });
  } finally {
    connection?.release();
  }
};
