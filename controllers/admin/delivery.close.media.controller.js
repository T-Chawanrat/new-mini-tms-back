import db from "../../config/db.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { cleanText, toNumberOrNull } from "../../utils/input.js";

const uploadsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../uploads");
const currentReceiveSerialSql = `(rs.item_is_deleted IS NULL OR rs.item_is_deleted = '' OR rs.item_is_deleted = '0' OR LOWER(rs.item_is_deleted) IN ('false', 'n', 'no'))`;
const receiveReferenceJoin = `LEFT JOIN (SELECT receive_id, GROUP_CONCAT(DISTINCT reference_no ORDER BY reference_no ASC SEPARATOR ', ') AS reference_no FROM tm_receive_references WHERE reference_no IS NOT NULL AND TRIM(reference_no) <> '' GROUP BY receive_id) ref ON ref.receive_id = COALESCE(rs.receive_business_id, rs.receive_walkin_id)`;
const uploadedFiles = (req, field) => (Array.isArray(req.files?.[field]) ? req.files[field] : []);
const safeFolderName = (value) =>
  String(value || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 80);
const displayFileName = (file, fallback) =>
  String(file.originalname || "")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_")
    .trim()
    .slice(0, 255) || fallback;

const activeMediaForBill = async (connection, bill) => {
  const [media] = await connection.query(
    `SELECT delivery_close_media_id, media_type, file_name, file_path
     FROM tm_delivery_close_media
     WHERE receive_business_id <=> ? AND receive_walkin_id <=> ? AND receive_code = ? AND is_deleted = 0
     ORDER BY delivery_close_media_id`,
    [bill.receive_business_id, bill.receive_walkin_id, bill.receive_code],
  );
  return media;
};

const serializeMedia = (media) => ({
  proof_images: media
    .filter((item) => item.media_type === "PROOF_IMAGE")
    .map((item) => ({ id: item.delivery_close_media_id, name: item.file_name, preview: item.file_path })),
  signature_images: media
    .filter((item) => item.media_type === "SIGNATURE_IMAGE")
    .map((item) => ({ id: item.delivery_close_media_id, name: item.file_name, preview: item.file_path })),
});

const getCompletedBill = async (connection, receiveCode, lock = false) => {
  const [items] = await connection.query(
    `SELECT rs.receive_business_id, rs.receive_walkin_id, rs.receive_code, rs.serial_id, rs.serial_no,
            COALESCE(close_status.delivery_status, '') AS delivery_status
     FROM tm_receive_serials rs
     LEFT JOIN tm_delivery_close close_status ON close_status.serial_id = rs.serial_id
     WHERE ${currentReceiveSerialSql} AND rs.receive_code = ?${lock ? " FOR UPDATE" : ""}`,
    [receiveCode],
  );
  if (!items.length) return null;
  const bill = {
    receive_business_id: items[0].receive_business_id,
    receive_walkin_id: items[0].receive_walkin_id,
    receive_code: items[0].receive_code,
  };
  if (items.some((item) => item.receive_business_id !== bill.receive_business_id || item.receive_walkin_id !== bill.receive_walkin_id)) return null;
  if (items.some((item) => item.delivery_status !== "COMPLETED")) return { ...bill, is_completed: false, serial_count: items.length };
  return { ...bill, is_completed: true, serial_count: items.length };
};

export const searchCompletedDeliveryCloseMedia = async (req, res) => {
  try {
    const search = cleanText(req.query.search)?.slice(0, 200) || "";
    const searchType = cleanText(req.query.search_type) || "receive_code";
    if (!search) return res.status(400).json({ success: false, message: "กรุณากรอกข้อมูลที่ต้องการค้นหา" });

    const filter =
      searchType === "serial_no"
        ? `EXISTS (SELECT 1 FROM tm_receive_serials lookup WHERE lookup.receive_business_id <=> rs.receive_business_id AND lookup.receive_walkin_id <=> rs.receive_walkin_id AND lookup.receive_code = rs.receive_code AND ${currentReceiveSerialSql.replaceAll("rs.", "lookup.")} AND lookup.serial_no LIKE ?)`
        : searchType === "reference_no"
          ? `COALESCE(ref.reference_no, '') LIKE ?`
          : `rs.receive_code LIKE ?`;
    const [bills] = await db.query(
      `SELECT rs.receive_business_id, rs.receive_walkin_id, rs.receive_code, MAX(ref.reference_no) AS reference_no,
              COUNT(*) AS serial_count
       FROM tm_receive_serials rs
       ${receiveReferenceJoin}
       LEFT JOIN tm_delivery_close close_status ON close_status.serial_id = rs.serial_id
       WHERE ${currentReceiveSerialSql} AND ${filter}
       GROUP BY rs.receive_business_id, rs.receive_walkin_id, rs.receive_code
       HAVING SUM(CASE WHEN close_status.delivery_status = 'COMPLETED' THEN 1 ELSE 0 END) = COUNT(*)
       ORDER BY rs.receive_code ASC`,
      [`%${search}%`],
    );
    const result = await Promise.all(bills.map(async (bill) => ({ ...bill, ...serializeMedia(await activeMediaForBill(db, bill)) })));
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("searchCompletedDeliveryCloseMedia error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถค้นหารายการปิดงานได้" });
  }
};

export const addCompletedDeliveryCloseMedia = async (req, res) => {
  let connection;
  const createdFiles = [];
  try {
    const actorId = toNumberOrNull(req.user?.id ?? req.user?.user_id);
    const receiveCode = cleanText(req.body.receive_code)?.slice(0, 50) || "";
    const proofFiles = uploadedFiles(req, "proof_images");
    const signatureFiles = uploadedFiles(req, "sign_images");
    const folderName = safeFolderName(receiveCode);
    if (!actorId || !receiveCode || !folderName || (!proofFiles.length && !signatureFiles.length))
      return res.status(400).json({ success: false, message: "กรุณาเลือกรูปที่ต้องการเพิ่ม" });

    connection = await db.getConnection();
    await connection.beginTransaction();
    const bill = await getCompletedBill(connection, receiveCode, true);
    if (!bill?.is_completed) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "พบรายการที่ยังปิดงานไม่ครบ" });
    }
    const existingMedia = await activeMediaForBill(connection, bill);
    const proofCount = existingMedia.filter((item) => item.media_type === "PROOF_IMAGE").length;
    const signatureCount = existingMedia.filter((item) => item.media_type === "SIGNATURE_IMAGE").length;
    if (proofCount + proofFiles.length > 8 || signatureCount + signatureFiles.length > 4) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "รูปหลักฐานเกิน 8 รูป หรือลายเซ็นเกิน 4 รูป" });
    }

    const now = new Date();
    for (const group of [
      { type: "PROOF_IMAGE", folder: "proof", files: proofFiles },
      { type: "SIGNATURE_IMAGE", folder: "signature", files: signatureFiles },
    ]) {
      for (const file of group.files) {
        const relativeDirectory = path.posix.join("delivery-closes", folderName, group.folder);
        const absoluteDirectory = path.join(uploadsDirectory, ...relativeDirectory.split("/"));
        const storedName = file.storedName;
        const absolutePath = path.join(absoluteDirectory, storedName);
        await fs.mkdir(absoluteDirectory, { recursive: true });
        await fs.writeFile(absolutePath, file.buffer);
        createdFiles.push(absolutePath);
        await connection.query(
          `INSERT INTO tm_delivery_close_media (receive_business_id, receive_walkin_id, receive_code, media_type, file_name, file_path, mime_type, file_size, is_deleted, created_by, created_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [
            bill.receive_business_id,
            bill.receive_walkin_id,
            receiveCode,
            group.type,
            displayFileName(file, storedName),
            `/uploads/${relativeDirectory}/${storedName}`,
            file.mimetype,
            file.size,
            actorId,
            now,
          ],
        );
      }
    }
    await connection.commit();
    return res.status(200).json({ success: true, data: serializeMedia(await activeMediaForBill(connection, bill)) });
  } catch (error) {
    await connection?.rollback();
    await Promise.all(createdFiles.map((filePath) => fs.unlink(filePath).catch(() => undefined)));
    console.error("addCompletedDeliveryCloseMedia error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถเพิ่มรูปได้" });
  } finally {
    connection?.release();
  }
};

export const deleteCompletedDeliveryCloseMedia = async (req, res) => {
  let connection;
  try {
    const actorId = toNumberOrNull(req.user?.id ?? req.user?.user_id);
    const mediaId = toNumberOrNull(req.params.mediaId);
    const receiveCode = cleanText(req.body.receive_code)?.slice(0, 50) || "";
    if (!actorId || !mediaId || !receiveCode) return res.status(400).json({ success: false, message: "ข้อมูลรูปไม่ถูกต้อง" });
    connection = await db.getConnection();
    await connection.beginTransaction();
    const bill = await getCompletedBill(connection, receiveCode, true);
    if (!bill?.is_completed) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "พบรายการที่ยังปิดงานไม่ครบ" });
    }
    const [result] = await connection.query(
      `UPDATE tm_delivery_close_media SET is_deleted = 1, deleted_by = ?, deleted_date = ?
       WHERE delivery_close_media_id = ? AND receive_business_id <=> ? AND receive_walkin_id <=> ? AND receive_code = ? AND is_deleted = 0`,
      [actorId, new Date(), mediaId, bill.receive_business_id, bill.receive_walkin_id, receiveCode],
    );
    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "ไม่พบรูปที่ต้องการลบ" });
    }
    await connection.commit();
    return res.status(200).json({ success: true, message: "ลบรูปออกจากรายการแล้ว" });
  } catch (error) {
    await connection?.rollback();
    console.error("deleteCompletedDeliveryCloseMedia error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถลบรูปได้" });
  } finally {
    connection?.release();
  }
};
