import db from "../../config/db.js";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { cleanText, toNumberOrNull } from "../../utils/input.js";
import { getPositiveInteger } from "../../utils/pagination.js";

const uploadsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../uploads");

const getBillStatus = (items) => {
  if (!items.length) return "PENDING_CLOSE";

  const statuses = items.map((item) => item.delivery_status || "PENDING_CLOSE");

  if (statuses.every((status) => status === "COMPLETED")) return "COMPLETED";
  if (statuses.every((status) => status === "RETURN_TO_SHIPPER")) return "RETURN_TO_SHIPPER";
  if (statuses.some((status) => status === "POSTPONED")) return "POSTPONED";

  return "PENDING_CLOSE";
};

const receiveReferenceJoin = `
  LEFT JOIN (
    SELECT receive_id, GROUP_CONCAT(DISTINCT reference_no ORDER BY reference_no ASC SEPARATOR ', ') AS reference_no
    FROM tm_receive_references
    WHERE reference_no IS NOT NULL AND TRIM(reference_no) <> ''
    GROUP BY receive_id
  ) ref
    ON ref.receive_id = COALESCE(rs.receive_business_id, rs.receive_walkin_id)
`;

const currentReceiveSerialSql = `
  (
    rs.item_is_deleted IS NULL
    OR rs.item_is_deleted = ''
    OR rs.item_is_deleted = '0'
    OR LOWER(rs.item_is_deleted) IN ('false', 'n', 'no')
  )
`;

const billKey = (receiveBusinessId, receiveWalkinId, receiveCode) => `${receiveBusinessId ?? ""}:${receiveWalkinId ?? ""}:${receiveCode}`;

const getActiveBillMedia = async (connection, bills, lock = false) => {
  if (!bills.length) return [];
  const condition = bills.map(() => "(receive_business_id <=> ? AND receive_walkin_id <=> ? AND receive_code = ?)").join(" OR ");
  const params = bills.flatMap((bill) => [bill.receive_business_id, bill.receive_walkin_id, bill.receive_code]);
  const [media] = await connection.query(
    `SELECT delivery_close_media_id, receive_business_id, receive_walkin_id, receive_code, media_type, file_name, file_path
     FROM tm_delivery_close_media
     WHERE is_deleted = 0 AND (${condition})
     ORDER BY delivery_close_media_id${lock ? " FOR UPDATE" : ""}`,
    params,
  );
  return media;
};

export const getDeliveryCompletes = async (req, res) => {
  try {
    const page = getPositiveInteger(req.query.page, 1, Number.MAX_SAFE_INTEGER);
    const limit = getPositiveInteger(req.query.limit, 50, 100);
    const search = cleanText(req.query.search)?.slice(0, 200) || null;
    const requestedSearchType = cleanText(req.query.search_type);
    const searchFieldByType = {
      receive_code: "rs.receive_code",
      serial_no: "rs.serial_no",
      reference_no: "COALESCE(ref.reference_no, '')",
    };
    const selectedSearchField = searchFieldByType[requestedSearchType];
    const searchSql = search ? `${selectedSearchField || "rs.receive_code"} LIKE ?` : "1 = 1";
    const searchParams = search ? [`%${search}%`] : [];
    const billIsRelevantSql = `(
      EXISTS (SELECT 1 FROM tm_product_actived active WHERE active.serial_id = rs.serial_id)
      OR EXISTS (SELECT 1 FROM tm_delivery_close status WHERE status.serial_id = rs.serial_id)
    )`;
    const offset = (page - 1) * limit;

    const [[countRow]] = await db.query(
      `
        SELECT COUNT(*) AS total_items
        FROM (
          SELECT rs.receive_business_id, rs.receive_walkin_id, rs.receive_code
          FROM tm_receive_serials rs
          ${receiveReferenceJoin}
          WHERE ${currentReceiveSerialSql} AND ${billIsRelevantSql} AND ${searchSql}
          GROUP BY rs.receive_business_id, rs.receive_walkin_id, rs.receive_code
        ) bills
      `,
      searchParams,
    );

    const [billRows] = await db.query(
      `
        SELECT
          rs.receive_business_id,
          rs.receive_walkin_id,
          rs.receive_code,
          MAX(ref.reference_no) AS reference_no,
          MIN(rs.delivery_date) AS delivery_date,
          MIN(rs.route_id) AS route_id
        FROM tm_receive_serials rs
        ${receiveReferenceJoin}
        WHERE ${currentReceiveSerialSql} AND ${billIsRelevantSql} AND ${searchSql}
        GROUP BY rs.receive_business_id, rs.receive_walkin_id, rs.receive_code
        ORDER BY MIN(rs.receive_date) DESC, rs.receive_code DESC
        LIMIT ? OFFSET ?
      `,
      [...searchParams, limit, offset],
    );

    if (!billRows.length) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { page, limit, total_items: Number(countRow.total_items || 0) },
      });
    }

    const billCondition = billRows.map(() => "(rs.receive_business_id <=> ? AND rs.receive_walkin_id <=> ? AND rs.receive_code = ?)").join(" OR ");
    const billParams = billRows.flatMap((bill) => [bill.receive_business_id, bill.receive_walkin_id, bill.receive_code]);
    const [itemRows] = await db.query(
      `
        SELECT
          rs.receive_business_id,
          rs.receive_walkin_id,
          rs.receive_code,
          rs.serial_id,
          rs.serial_no,
          delivery_status.delivery_status_id,
          COALESCE(delivery_status.delivery_status, 'PENDING_CLOSE') AS delivery_status,
          delivery_status.status_note,
          delivery_status.delivered_datetime
        FROM tm_receive_serials rs
        LEFT JOIN tm_delivery_close delivery_status ON delivery_status.serial_id = rs.serial_id
        WHERE ${currentReceiveSerialSql} AND (${billCondition})
        ORDER BY rs.receive_code, rs.serial_no
      `,
      billParams,
    );

    const billMediaRows = await getActiveBillMedia(db, billRows);
    const mediaByBillKey = new Map();
    for (const media of billMediaRows) {
      const key = billKey(media.receive_business_id, media.receive_walkin_id, media.receive_code);
      const items = mediaByBillKey.get(key) || [];
      items.push({ id: media.delivery_close_media_id, name: media.file_name, preview: media.file_path, media_type: media.media_type });
      mediaByBillKey.set(key, items);
    }

    const itemsByBillKey = new Map();
    for (const item of itemRows) {
      const key = billKey(item.receive_business_id, item.receive_walkin_id, item.receive_code);
      const items = itemsByBillKey.get(key) || [];
      items.push(item);
      itemsByBillKey.set(key, items);
    }

    const data = billRows.map((bill) => {
      const key = billKey(bill.receive_business_id, bill.receive_walkin_id, bill.receive_code);
      const items = itemsByBillKey.get(key) || [];
      const billMedia = mediaByBillKey.get(key) || [];
      const deliveredItems = items.filter((item) => item.delivery_status === "COMPLETED");
      const postponedItem = items.find((item) => item.delivery_status === "POSTPONED");
      const proofImages = billMedia.filter((media) => media.media_type === "PROOF_IMAGE");
      const signatureImages = billMedia.filter((media) => media.media_type === "SIGNATURE_IMAGE");
      const postponeImages = [];
      const latestCompletedItem = deliveredItems
        .filter((item) => item.delivered_datetime)
        .sort((left, right) => new Date(right.delivered_datetime) - new Date(left.delivered_datetime))[0];

      return {
        id: key,
        receive_business_id: bill.receive_business_id,
        receive_walkin_id: bill.receive_walkin_id,
        truck_code: "-",
        route_id: bill.route_id,
        route_code: "-",
        route_name: "-",
        driver_name: "-",
        operator_name: "-",
        license_plate: "-",
        license_plate_province: "-",
        departure_at: bill.delivery_date,
        bill_no: bill.receive_code,
        reference_no: bill.reference_no || "-",
        serial_items: items.map((item) => ({ serial_id: item.serial_id, serial_no: item.serial_no, delivery_status: item.delivery_status })),
        serial_numbers: items.map((item) => item.serial_no),
        delivered_serial_numbers: deliveredItems.map((item) => item.serial_no),
        delivered_serial_ids: deliveredItems.map((item) => item.serial_id),
        status: getBillStatus(items),
        status_note: postponedItem?.status_note || null,
        next_delivery_date: postponedItem?.next_delivery_date || null,
        completed_at: latestCompletedItem?.delivered_datetime || null,
        proof_images: proofImages,
        signature_images: signatureImages,
        postpone_images: postponeImages,
      };
    });

    return res.status(200).json({
      success: true,
      data,
      pagination: { page, limit, total_items: Number(countRow.total_items || 0) },
    });
  } catch (error) {
    console.error("getDeliveryCompletes error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดรายการจัดส่งเสร็จสิ้นได้" });
  }
};

const parseSerialIds = (value) => {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? [...new Set(parsed.map((serialId) => String(serialId || "").trim()).filter(Boolean))] : [];
  } catch {
    return [];
  }
};

const fileExtension = (file) => {
  const extension = path.extname(file.originalname || "").toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp"].includes(extension)
    ? extension
    : file.mimetype === "image/png"
      ? ".png"
      : file.mimetype === "image/webp"
        ? ".webp"
        : ".jpg";
};

const uploadedFiles = (req, field) => (Array.isArray(req.files?.[field]) ? req.files[field] : []);
const shortFileName = (file) => `${randomUUID().replace(/-/g, "").slice(0, 16)}${fileExtension(file)}`;
const displayFileName = (file, fallback) => {
  const name = String(file.originalname || "")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_")
    .trim()
    .slice(0, 255);
  return name || fallback;
};
const receiveFolderName = (value) =>
  String(value || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 80);
const optionalNumber = (value, min, max) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
};

export const saveDeliveryCompleteStatuses = async (req, res) => {
  let connection;
  const createdFiles = [];

  try {
    const warehouseId = toNumberOrNull(req.user?.warehouse_id);
    const actorId = toNumberOrNull(req.user?.id ?? req.user?.user_id);
    const receiveCode = cleanText(req.body.receive_code)?.slice(0, 50) || "";
    const serialIds = parseSerialIds(req.body.serial_ids);
    const safeReceiveCode = receiveFolderName(receiveCode);
    const deliveredAtInput = cleanText(req.body.delivered_datetime);
    const deliveredAt = deliveredAtInput && !Number.isNaN(new Date(deliveredAtInput).getTime()) ? new Date(deliveredAtInput) : new Date();
    const lat = optionalNumber(req.body.lat, -90, 90);
    const lng = optionalNumber(req.body.lng, -180, 180);
    const accuracyM = optionalNumber(req.body.accuracy_m, 0, 100000);
    const proofFiles = uploadedFiles(req, "proof_images");
    const signFiles = uploadedFiles(req, "sign_images");

    if (!warehouseId || !actorId || !receiveCode || !safeReceiveCode || !serialIds.length) {
      return res.status(400).json({ success: false, message: "กรุณาเลือก SN ที่จัดส่งสำเร็จ" });
    }
    if (lat === undefined || lng === undefined || accuracyM === undefined)
      return res.status(400).json({ success: false, message: "พิกัดไม่ถูกต้อง" });

    connection = await db.getConnection();
    await connection.beginTransaction();

    const placeholders = serialIds.map(() => "?").join(", ");
    const [products] = await connection.query(
      `SELECT DISTINCT active.serial_id, rs.serial_no, rs.receive_business_id, rs.receive_walkin_id
       FROM tm_product_actived active
       INNER JOIN tm_receive_serials rs ON rs.serial_id = active.serial_id
       WHERE ${currentReceiveSerialSql} AND active.serial_id IN (${placeholders}) AND rs.receive_code = ? FOR UPDATE`,
      [...serialIds, receiveCode],
    );
    if (products.length !== serialIds.length) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "พบ SN ที่ไม่อยู่ในบิลนี้หรือไม่ได้อยู่ในรายการ active" });
    }

    const bill = {
      receive_business_id: products[0].receive_business_id,
      receive_walkin_id: products[0].receive_walkin_id,
      receive_code: receiveCode,
    };
    if (products.some((product) => product.receive_business_id !== bill.receive_business_id || product.receive_walkin_id !== bill.receive_walkin_id)) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "SN ที่เลือกต้องอยู่ในบิลเดียวกัน" });
    }

    const existingMedia = await getActiveBillMedia(connection, [bill], true);
    const existingProofCount = existingMedia.filter((media) => media.media_type === "PROOF_IMAGE").length;
    const existingSignatureCount = existingMedia.filter((media) => media.media_type === "SIGNATURE_IMAGE").length;
    if (existingProofCount + proofFiles.length > 8 || existingSignatureCount + signFiles.length > 4) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "รูปหลักฐานเกิน 8 รูป หรือลายเซ็นเกิน 4 รูป" });
    }
    if (existingProofCount + proofFiles.length < 1 || existingSignatureCount + signFiles.length < 1) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "กรุณาเพิ่มรูปหลักฐานและลายเซ็นอย่างน้อยอย่างละ 1 รูป" });
    }

    const [lastTransactions] = await connection.query(
      `SELECT serial_id FROM tm_product_transactions_last WHERE serial_id IN (${placeholders}) FOR UPDATE`,
      serialIds,
    );
    if (new Set(lastTransactions.map((item) => item.serial_id)).size !== serialIds.length) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "ไม่พบประวัติรายการล่าสุดของ SN ที่เลือก" });
    }

    const now = new Date();
    for (const product of products) {
      await connection.query(
        `INSERT INTO tm_delivery_close (truck_load_id, serial_id, serial_no, delivery_status, delivered_datetime, source, lat, lng, accuracy_m, created_by, created_date, updated_by, updated_date)
         VALUES (NULL, ?, ?, 'COMPLETED', ?, 'WEB_ADMIN', ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE truck_load_id = NULL, delivery_status = 'COMPLETED', delivered_datetime = VALUES(delivered_datetime), source = 'WEB_ADMIN', lat = VALUES(lat), lng = VALUES(lng), accuracy_m = VALUES(accuracy_m), updated_by = VALUES(updated_by), updated_date = VALUES(updated_date)`,
        [product.serial_id, product.serial_no, deliveredAt, lat, lng, accuracyM, actorId, now, actorId, now],
      );
    }

    const mediaGroups = [
      { type: "PROOF_IMAGE", folder: "proof", files: proofFiles },
      { type: "SIGNATURE_IMAGE", folder: "signature", files: signFiles },
    ];
    for (const group of mediaGroups) {
      for (const file of group.files) {
        const relativeDirectory = path.posix.join("delivery-closes", safeReceiveCode, group.folder);
        const absoluteDirectory = path.join(uploadsDirectory, ...relativeDirectory.split("/"));
        const storedName = shortFileName(file);
        const originalName = displayFileName(file, storedName);
        const absolutePath = path.join(absoluteDirectory, storedName);
        const filePath = `/uploads/${relativeDirectory}/${storedName}`;
        await fs.mkdir(absoluteDirectory, { recursive: true });
        await fs.writeFile(absolutePath, file.buffer);
        createdFiles.push(absolutePath);
        await connection.query(
          `INSERT INTO tm_delivery_close_media (
             receive_business_id, receive_walkin_id, receive_code, media_type,
             file_name, file_path, mime_type, file_size, is_deleted, created_by, created_date
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [bill.receive_business_id, bill.receive_walkin_id, receiveCode, group.type, originalName, filePath, file.mimetype, file.size, actorId, now],
        );
      }
    }

    const year = now.getFullYear();
    const yearMonth = year * 100 + now.getMonth() + 1;
    await connection.query(
      `INSERT INTO tm_product_transactions (
         receive_business_id, receive_walkin_id, receive_code, serial_id, serial_no,
         status_message, status_id, datetime, update_date, type,
         warehouse_id, created_by, latitude, longitude, warehouse_name,
         address, province_name, district_name, subdistrict_name, zip_code,
         created_name, username, user_id, data_year, data_yearmonth
       )
       SELECT
         rs.receive_business_id, rs.receive_walkin_id, rs.receive_code, active.serial_id, rs.serial_no,
         'จัดส่งสำเร็จ', 18, ?, ?, 'WEB_ADMIN',
         ?, ?, ?, ?, previous.warehouse_name,
         previous.address, previous.province_name, previous.district_name, previous.subdistrict_name, previous.zip_code,
         previous.created_name, previous.username, previous.user_id, ?, ?
       FROM tm_product_actived active
       INNER JOIN tm_receive_serials rs ON rs.serial_id = active.serial_id
       INNER JOIN tm_product_transactions_last previous ON previous.serial_id = active.serial_id
       WHERE ${currentReceiveSerialSql} AND active.serial_id IN (${placeholders}) AND rs.receive_code = ?`,
      [
        deliveredAt,
        now,
        warehouseId,
        actorId,
        lat === null ? null : String(lat),
        lng === null ? null : String(lng),
        year,
        yearMonth,
        ...serialIds,
        receiveCode,
      ],
    );
    await connection.query(
      `UPDATE tm_product_transactions_last
       SET status_message = 'จัดส่งสำเร็จ', status_id = 18, datetime = ?, update_date = ?, type = 'WEB_ADMIN', warehouse_id = ?, created_by = ?, latitude = ?, longitude = ?
       WHERE serial_id IN (${placeholders})`,
      [deliveredAt, now, warehouseId, actorId, lat === null ? null : String(lat), lng === null ? null : String(lng), ...serialIds],
    );
    await connection.query(`DELETE FROM tm_product_actived WHERE serial_id IN (${placeholders})`, serialIds);

    await connection.commit();
    const activeMedia = await getActiveBillMedia(connection, [bill]);
    return res.status(200).json({
      success: true,
      message: "บันทึกผลจัดส่งสำเร็จ",
      data: {
        receive_code: receiveCode,
        serial_ids: serialIds,
        proof_images: activeMedia.filter((media) => media.media_type === "PROOF_IMAGE").map((media) => ({ id: media.delivery_close_media_id, name: media.file_name, preview: media.file_path })),
        signature_images: activeMedia.filter((media) => media.media_type === "SIGNATURE_IMAGE").map((media) => ({ id: media.delivery_close_media_id, name: media.file_name, preview: media.file_path })),
      },
    });
  } catch (error) {
    await connection?.rollback();
    await Promise.all(createdFiles.map((filePath) => fs.unlink(filePath).catch(() => undefined)));
    console.error("saveDeliveryCompleteStatuses error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถบันทึกผลจัดส่งได้" });
  } finally {
    connection?.release();
  }
};

export const softDeleteDeliveryCloseMedia = async (req, res) => {
  let connection;
  try {
    const actorId = toNumberOrNull(req.user?.id ?? req.user?.user_id);
    const mediaId = toNumberOrNull(req.params.mediaId);
    const receiveCode = cleanText(req.body?.receive_code)?.slice(0, 50) || "";
    const now = new Date();
    if (!actorId || !mediaId || !receiveCode) return res.status(400).json({ success: false, message: "ข้อมูลรูปไม่ถูกต้อง" });

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [mediaRows] = await connection.query(
      `SELECT receive_business_id, receive_walkin_id
       FROM tm_delivery_close_media
       WHERE delivery_close_media_id = ? AND receive_code = ? AND is_deleted = 0
       FOR UPDATE`,
      [mediaId, receiveCode],
    );
    if (!mediaRows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "ไม่พบรูปที่ต้องการลบ" });
    }
    const media = mediaRows[0];
    const [activeRows] = await connection.query(
      `SELECT 1
       FROM tm_product_actived active
       INNER JOIN tm_receive_serials rs ON rs.serial_id = active.serial_id
       WHERE ${currentReceiveSerialSql}
         AND rs.receive_business_id <=> ?
         AND rs.receive_walkin_id <=> ?
         AND rs.receive_code = ?
       LIMIT 1`,
      [media.receive_business_id, media.receive_walkin_id, receiveCode],
    );
    if (!activeRows.length) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "บิลปิดงานสมบูรณ์แล้ว กรุณาแก้ไขจากหน้าจัดการหลักฐาน" });
    }
    const [result] = await connection.query(
      `UPDATE tm_delivery_close_media
       SET is_deleted = 1, deleted_by = ?, deleted_date = ?
       WHERE delivery_close_media_id = ? AND receive_code = ? AND is_deleted = 0`,
      [actorId, now, mediaId, receiveCode],
    );
    await connection.commit();
    return res.status(200).json({ success: true, message: "ลบรูปออกจากรายการแล้ว" });
  } catch (error) {
    await connection?.rollback();
    console.error("softDeleteDeliveryCloseMedia error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถลบรูปได้" });
  } finally {
    connection?.release();
  }
};
