import db from "../../config/db.js";
import { toNumberOrNull } from "../../utils/input.js";
import fs from "fs/promises";
import { buildTruckVehicleSql } from "../../utils/truck.js";
import { parseCoordinate } from "../../utils/location.js";
import { saveDriverDeliveryMedia } from "../../services/driver/delivery-media.js";
import { saveDriverDeliveryTransactions } from "../../services/driver/delivery-transaction.js";

const billKeyOf = (row) => JSON.stringify([row.receive_business_id, row.receive_walkin_id, row.receive_code]);
const recipientKeyOf = (row) => {
  const address = [row.address, row.subdistrict_name, row.district_name, row.province_name, row.zip_code].map((part) => String(part ?? "").trim());
  const detailId = toNumberOrNull(row.recipient_detail_id);
  return detailId ? JSON.stringify(["detail", detailId, ...address]) : JSON.stringify(["bill", billKeyOf(row)]);
};

export const getDriverDeliverySummary = async (req, res) => {
  try {
    const driverId = toNumberOrNull(req.user?.id);
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);
    if (!driverId || !warehouseId) {
      return res.status(400).json({ success: false, message: "ข้อมูลผู้ขับรถไม่ถูกต้อง" });
    }
    const [[result]] = await db.query(
      `SELECT COUNT(DISTINCT truck.id) AS truckCount
       FROM tm_trucks truck
       INNER JOIN tm_product_trucks product ON product.truck_load_id = truck.id
       INNER JOIN tm_product_actived active ON active.serial_id = product.serial_id AND active.serial_no = product.serial_no
       INNER JOIN tm_receive_serials rs ON rs.serial_id = product.serial_id AND rs.serial_no = product.serial_no
       WHERE truck.user_truck_id = ? AND truck.warehouse_id = ?
         AND truck.status = 'DC_TRUCK' AND truck.is_close = 'Y' AND truck.is_go = 'Y'
         AND COALESCE(truck.is_deleted, 'N') = 'N' AND product.status = 'IN_TRANSIT'
         AND (rs.item_is_deleted IS NULL OR rs.item_is_deleted = '' OR rs.item_is_deleted = '0'
              OR LOWER(rs.item_is_deleted) IN ('false', 'n', 'no'))`,
      [driverId, warehouseId],
    );
    return res.json({ success: true, data: { truckCount: Number(result.truckCount) } });
  } catch (error) {
    console.error("getDriverDeliverySummary error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดข้อมูลสรุปการนำจ่ายได้" });
  }
};

export const getDriverDeliveries = async (req, res) => {
  try {
    const driverId = toNumberOrNull(req.user?.id);
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);
    if (!driverId || !warehouseId) {
      return res.status(400).json({ success: false, message: "ข้อมูลผู้ขับรถไม่ถูกต้อง" });
    }

    const [rows] = await db.query(
      `SELECT truck.id AS truck_load_id, rs.receive_business_id, rs.receive_walkin_id, rs.receive_code,
              rs.serial_id, rs.serial_no, rs.recipient_detail_id, rs.recipient_name, product.status AS truck_product_status,
              rs.address, rs.subdistrict_name, rs.district_name, rs.province_name, rs.zip_code, rs.tel, rs.remark
       FROM tm_trucks truck
       INNER JOIN tm_product_trucks product ON product.truck_load_id = truck.id
       LEFT JOIN tm_product_actived active
         ON active.serial_id = product.serial_id AND active.serial_no = product.serial_no
       LEFT JOIN tm_delivery_close close_status
         ON close_status.serial_id = product.serial_id AND close_status.serial_no = product.serial_no
         AND close_status.truck_load_id = product.truck_load_id AND close_status.delivery_status = 'COMPLETED'
       INNER JOIN tm_receive_serials rs
         ON rs.serial_id = product.serial_id AND rs.serial_no = product.serial_no
       WHERE truck.user_truck_id = ? AND truck.warehouse_id = ?
         AND truck.status = 'DC_TRUCK' AND truck.is_close = 'Y' AND truck.is_go = 'Y'
         AND COALESCE(truck.is_deleted, 'N') = 'N'
         AND ((product.status = 'IN_TRANSIT' AND active.serial_id IS NOT NULL)
           OR (product.status = 'DELIVERED' AND active.serial_id IS NULL AND close_status.serial_id IS NOT NULL))
         AND (rs.item_is_deleted IS NULL OR rs.item_is_deleted = '' OR rs.item_is_deleted = '0'
              OR LOWER(rs.item_is_deleted) IN ('false', 'n', 'no'))
       ORDER BY rs.recipient_name, rs.receive_code, rs.serial_no, CASE WHEN product.status = 'IN_TRANSIT' THEN 0 ELSE 1 END`,
      [driverId, warehouseId],
    );

    const billRows = [...new Map(rows.map((row) => [billKeyOf(row), row])).values()];
    const mediaByBill = new Map();
    if (billRows.length) {
      const condition = billRows.map(() => "(receive_business_id <=> ? AND receive_walkin_id <=> ? AND receive_code = ?)").join(" OR ");
      const [media] = await db.query(
        `SELECT receive_business_id, receive_walkin_id, receive_code, media_type, file_path FROM tm_delivery_close_media WHERE is_deleted = 0 AND (${condition})`,
        billRows.flatMap((row) => [row.receive_business_id, row.receive_walkin_id, row.receive_code]),
      );
      for (const item of media) {
        const key = billKeyOf(item);
        if (!mediaByBill.has(key)) mediaByBill.set(key, { proof: [], signatures: [] });
        if (item.media_type === "PROOF_IMAGE") mediaByBill.get(key).proof.push(item.file_path);
        if (item.media_type === "SIGNATURE_IMAGE") mediaByBill.get(key).signatures.push(item.file_path);
      }
    }
    const recipients = new Map();
    const serials = new Set();
    const bills = new Set();
    const trucks = new Set();
    for (const row of rows) {
      const completed = row.truck_product_status === "DELIVERED";
      if (!completed) trucks.add(row.truck_load_id);
      const serialKey = JSON.stringify([row.serial_id, row.serial_no]);
      if (serials.has(serialKey)) continue;
      serials.add(serialKey);

      const billKey = billKeyOf(row);
      if (!completed) bills.add(billKey);
      const addressParts = [row.address, row.subdistrict_name, row.district_name, row.province_name, row.zip_code].map((part) =>
        String(part ?? "").trim(),
      );
      const groupKey = recipientKeyOf(row);
      if (!recipients.has(groupKey)) {
        recipients.set(groupKey, {
          key: groupKey,
          name: row.recipient_name || "ไม่ระบุผู้รับ",
          address: addressParts.filter(Boolean).join(" ") || "ไม่ระบุที่อยู่",
          phones: new Set(),
          bills: new Map(),
          serialCount: 0,
        });
      }
      const recipient = recipients.get(groupKey);
      const phone = String(row.tel ?? "").trim();
      if (phone) recipient.phones.add(phone);
      if (!recipient.bills.has(billKey)) {
        recipient.bills.set(billKey, {
          key: billKey,
          receiveCode: row.receive_code,
          serials: [],
          remarks: new Set(),
          media: mediaByBill.get(billKey) || { proof: [], signatures: [] },
        });
      }
      const bill = recipient.bills.get(billKey);
      bill.serials.push({ id: row.serial_id, serialNo: row.serial_no, completed });
      const remark = String(row.remark ?? "").trim();
      if (remark) bill.remarks.add(remark);
      if (!completed) recipient.serialCount += 1;
    }

    return res.json({
      success: true,
      data: {
        recipientCount: [...recipients.values()].filter((recipient) => recipient.serialCount > 0).length,
        billCount: bills.size,
        serialCount: [...recipients.values()].reduce((count, recipient) => count + recipient.serialCount, 0),
        truckCount: trucks.size,
        recipients: [...recipients.values()].filter((recipient) => recipient.serialCount > 0).map(({ bills: recipientBills, phones, ...recipient }) => ({
          ...recipient,
          phones: [...phones],
          billCount: recipientBills.size,
          bills: [...recipientBills.values()].map(({ remarks, ...bill }) => ({ ...bill, remarks: [...remarks] })),
        })),
      },
    });
  } catch (error) {
    console.error("getDriverDeliveries error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดรายการสินค้าบนรถได้" });
  }
};

export const completeDriverDeliveries = async (req, res) => {
  let connection;
  const createdFiles = [];
  let committed = false;
  try {
    const driverId = toNumberOrNull(req.user?.id);
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);
    let serials;
    try {
      serials = JSON.parse(req.body.serials || "[]");
    } catch {
      serials = [];
    }
    if (
      !driverId ||
      !warehouseId ||
      !Array.isArray(serials) ||
      !serials.length ||
      serials.length > 1000 ||
      serials.some((item) => !item?.serial_id || !item?.serial_no || typeof item.serial_no !== "string")
    ) {
      return res.status(400).json({ success: false, message: "กรุณาเลือก SN ที่ต้องการปิดงาน" });
    }
    const pairs = serials.map((item) => [String(item.serial_id), item.serial_no]);
    if (new Set(pairs.map((pair) => JSON.stringify(pair))).size !== pairs.length)
      return res.status(400).json({ success: false, message: "พบ SN ซ้ำในรายการ" });
    const lat = parseCoordinate(req.body.lat, -90, 90, false);
    const lng = parseCoordinate(req.body.lng, -180, 180, false);
    const accuracy = parseCoordinate(req.body.accuracy_m, 0, 999999.99, false);
    if (
      [lat, lng, accuracy].includes(false) ||
      ([lat, lng, accuracy].some((v) => v === null) && ![lat, lng, accuracy].every((v) => v === null))
    ) {
      return res.status(400).json({ success: false, message: "ข้อมูลพิกัดไม่ถูกต้อง" });
    }
    const proof = req.files?.proof_images || [];
    const signature = req.files?.sign_images || [];
    connection = await db.getConnection();
    await connection.beginTransaction();
    const placeholders = pairs.map(() => "(?, ?)").join(", ");
    const params = pairs.flat();
    const [products] = await connection.query(
      `SELECT product.id AS product_truck_id, product.truck_load_id, product.serial_id, product.serial_no,
              product.user_truck_id, product.driver_name, product.truck_id, product.route_id AS parcel_route_id,
              truck.route_id AS truck_route_id, truck.to_warehouse_id AS truck_to_warehouse_id,
              rs.receive_business_id, rs.receive_walkin_id, rs.receive_code, rs.recipient_detail_id,
              rs.address, rs.subdistrict_name, rs.district_name, rs.province_name, rs.zip_code,
              rs.to_warehouse_id AS parcel_to_warehouse_id,
              ${buildTruckVehicleSql().licensePlate} AS truck_license_plate,
              ${buildTruckVehicleSql().licensePlateProvinceId} AS license_plate_province_id
       FROM tm_product_trucks product
       JOIN tm_trucks truck ON truck.id = product.truck_load_id
       JOIN tm_product_actived active ON active.serial_id = product.serial_id AND active.serial_no = product.serial_no
       JOIN tm_receive_serials rs ON rs.serial_id = product.serial_id AND rs.serial_no = product.serial_no
       LEFT JOIN mm_vehicles vehicle ON vehicle.id = product.truck_id
       LEFT JOIN mm_vehicles_contractor contractor_vehicle ON contractor_vehicle.id = truck.vehicle_contractor_id
       WHERE (product.serial_id, product.serial_no) IN (${placeholders}) AND product.status = 'IN_TRANSIT'
         AND truck.user_truck_id = ? AND truck.warehouse_id = ? AND truck.status = 'DC_TRUCK'
         AND truck.is_close = 'Y' AND truck.is_go = 'Y' AND COALESCE(truck.is_deleted, 'N') = 'N'
         AND (rs.item_is_deleted IS NULL OR rs.item_is_deleted = '' OR rs.item_is_deleted = '0' OR LOWER(rs.item_is_deleted) IN ('false', 'n', 'no'))
       FOR UPDATE`,
      [...params, driverId, warehouseId],
    );
    if (
      products.length !== pairs.length ||
      new Set(products.map((row) => JSON.stringify([String(row.serial_id), row.serial_no]))).size !== pairs.length ||
      new Set(products.map(recipientKeyOf)).size !== 1
    ) {
      const error = new Error("รายการเปลี่ยนแปลงแล้ว หรือ SN ไม่ได้อยู่ในงานของผู้รับรายนี้ กรุณาโหลดใหม่");
      error.status = 409;
      throw error;
    }
    const [last] = await connection.query(
      `SELECT serial_id, serial_no FROM tm_product_transactions_last WHERE (serial_id, serial_no) IN (${placeholders}) FOR UPDATE`,
      params,
    );
    if (last.length !== pairs.length || new Set(last.map((row) => JSON.stringify([String(row.serial_id), row.serial_no]))).size !== pairs.length) {
      const error = new Error("ไม่พบสถานะล่าสุดของ SN บางรายการ");
      error.status = 409;
      throw error;
    }
    const bills = [...new Map(products.map((row) => [billKeyOf(row), row])).values()].sort((a, b) => billKeyOf(a).localeCompare(billKeyOf(b)));
    const now = new Date();
    await saveDriverDeliveryMedia({ connection, bills, proof, signature, createdFiles, driverId, now });
    await saveDriverDeliveryTransactions({ connection, products, now, lat, lng, accuracy, driverId, warehouseId });
await connection.commit();
    committed = true;
    return res.json({ success: true, message: "บันทึกการจัดส่งสำเร็จ" });
  } catch (error) {
    if (!committed) {
      await connection?.rollback().catch(() => {});
      await Promise.all(createdFiles.map((file) => fs.unlink(file).catch(() => {})));
    }
    console.error("completeDriverDeliveries error:", error);
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "ไม่สามารถบันทึกการจัดส่งได้" });
  } finally {
    connection?.release();
  }
};


