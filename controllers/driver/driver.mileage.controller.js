import fs from "fs/promises";
import db from "../../config/db.js";
import { cleanText, toNumberOrNull } from "../../utils/input.js";
import { parseCoordinate } from "../../utils/location.js";
import { saveMileageImages } from "../../services/driver/mileage-media.js";

const inputError = (message, status = 400) => Object.assign(new Error(message), { status });

const readInput = (req, maxPhotos) => {
  const files = req.files || [];
  if (!files.length || files.length > maxPhotos || files.some((file) => !file.storedName)) {
    throw inputError(`กรุณาเลือกรูปอย่างน้อย 1 รูป และไม่เกิน ${maxPhotos} รูป`);
  }
  const mileage = req.body.mileage === undefined || req.body.mileage === "" ? null : toNumberOrNull(req.body.mileage);
  if (req.body.mileage != null && req.body.mileage !== "" && (mileage === null || mileage < 0 || mileage >= 10000000000)) {
    throw inputError("เลขไมล์ไม่ถูกต้อง");
  }
  const latitude = parseCoordinate(req.body.latitude, -90, 90, false);
  const longitude = parseCoordinate(req.body.longitude, -180, 180, false);
  const accuracy = parseCoordinate(req.body.accuracy_m, 0, 99999999.99, false);
  if ([latitude, longitude, accuracy].includes(false) || (latitude === null) !== (longitude === null) || (latitude === null && accuracy !== null)) {
    throw inputError("ข้อมูลพิกัดไม่ถูกต้อง");
  }
  return { files, mileage, latitude, longitude, accuracy };
};

export const getCurrentMileage = async (req, res) => {
  try {
    const driverId = toNumberOrNull(req.user?.id);
    if (!driverId) throw inputError("ข้อมูลผู้ขับรถไม่ถูกต้อง");
    const [rows] = await db.query(
      `SELECT id, driver_id, driver_name, license_plate, license_plate_province, open_mileage, open_datetime,
              open_latitude, open_longitude, open_accuracy_m, status
       FROM tm_driver_mileage WHERE driver_id = ? AND status = 'OPEN' ORDER BY id DESC LIMIT 1`,
      [driverId],
    );
    return res.json({ success: true, data: rows[0] || null });
  } catch (error) {
    console.error("getCurrentMileage error:", error);
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "ไม่สามารถโหลดข้อมูลไมล์ได้" });
  }
};

export const openMileage = async (req, res) => {
  let connection;
  let committed = false;
  const createdFiles = [];
  try {
    const driverId = toNumberOrNull(req.user?.id);
    if (!driverId) throw inputError("ข้อมูลผู้ขับรถไม่ถูกต้อง");
    const input = readInput(req, 2);
    const plate = cleanText(req.body.license_plate);
    const province = cleanText(req.body.license_plate_province);
    if (!plate) throw inputError("กรุณาเลือกทะเบียนรถ");
    if ((plate?.length || 0) > 100 || (province?.length || 0) > 100) throw inputError("ข้อมูลทะเบียนรถยาวเกินไป");

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [[driver]] = await connection.query("SELECT first_name, last_name, username FROM um_users WHERE id = ? FOR UPDATE", [driverId]);
    if (!driver) throw inputError("ไม่พบข้อมูลผู้ขับรถ", 404);
    const [[existing]] = await connection.query("SELECT id FROM tm_driver_mileage WHERE driver_id = ? AND status = 'OPEN' LIMIT 1 FOR UPDATE", [
      driverId,
    ]);
    if (existing) throw inputError("คุณมีรอบไมล์ที่เปิดอยู่แล้ว", 409);
    const name = [driver.first_name, driver.last_name].filter(Boolean).join(" ").trim() || driver.username;
    if (!name || name.length > 255) throw inputError("ข้อมูลชื่อผู้ขับรถไม่ถูกต้อง");
    const now = new Date();
    const [result] = await connection.query(
      `INSERT INTO tm_driver_mileage (driver_id, driver_name, license_plate, license_plate_province, open_mileage, open_datetime, open_latitude, open_longitude, open_accuracy_m, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
      [driverId, name, plate, province, input.mileage, now, input.latitude, input.longitude, input.accuracy],
    );
    await saveMileageImages({ connection, mileageId: result.insertId, driverId, type: "OPEN", files: input.files, now, createdFiles });
    await connection.commit();
    committed = true;
    return res.status(201).json({ success: true, message: "เปิดไมล์สำเร็จ", data: { id: result.insertId, status: "OPEN", open_datetime: now } });
  } catch (error) {
    if (!committed) {
      await connection?.rollback().catch(() => {});
      await Promise.all(createdFiles.map((file) => fs.unlink(file).catch(() => {})));
    }
    console.error("openMileage error:", error);
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "ไม่สามารถเปิดไมล์ได้" });
  } finally {
    connection?.release();
  }
};

export const closeMileage = async (req, res) => {
  let connection;
  let committed = false;
  const createdFiles = [];
  try {
    const driverId = toNumberOrNull(req.user?.id);
    const mileageId = toNumberOrNull(req.params.mileageId);
    if (!driverId || !Number.isInteger(mileageId) || mileageId <= 0) throw inputError("ข้อมูลรอบไมล์ไม่ถูกต้อง");
    const input = readInput(req, 5);
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [[mileage]] = await connection.query("SELECT id FROM tm_driver_mileage WHERE id = ? AND driver_id = ? AND status = 'OPEN' FOR UPDATE", [
      mileageId,
      driverId,
    ]);
    if (!mileage) throw inputError("ไม่พบรอบไมล์ที่เปิดอยู่ของคุณ", 404);
    const now = new Date();
    await saveMileageImages({ connection, mileageId, driverId, type: "CLOSE", files: input.files, now, createdFiles });
    await connection.query(
      `UPDATE tm_driver_mileage SET close_mileage = ?, close_datetime = ?, close_latitude = ?, close_longitude = ?, close_accuracy_m = ?, status = 'CLOSED' WHERE id = ? AND driver_id = ?`,
      [input.mileage, now, input.latitude, input.longitude, input.accuracy, mileageId, driverId],
    );
    await connection.commit();
    committed = true;
    return res.json({ success: true, message: "ปิดไมล์สำเร็จ", data: { id: mileageId, status: "CLOSED", close_datetime: now } });
  } catch (error) {
    if (!committed) {
      await connection?.rollback().catch(() => {});
      await Promise.all(createdFiles.map((file) => fs.unlink(file).catch(() => {})));
    }
    console.error("closeMileage error:", error);
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "ไม่สามารถปิดไมล์ได้" });
  } finally {
    connection?.release();
  }
};
