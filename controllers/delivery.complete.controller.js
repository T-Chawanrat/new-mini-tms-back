import db from "../config/db.js";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { cleanDbText, toNumberOrNull } from "../utils/cleanText.js";
import { getPositiveInteger } from "../utils/pagination.js";

const getWarehouseId = (req) => toNumberOrNull(req.user?.warehouse_id);
const getActorId = (req) => toNumberOrNull(req.user?.id ?? req.user?.user_id);
const uploadsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../uploads");

const DELIVERY_STATUS_VALUES = new Set([
  "COMPLETED",
  "POSTPONED",
  "RETURN_TO_SHIPPER",
]);

const MEDIA_FIELDS = [
  { field: "proof_images", mediaType: "PROOF_IMAGE", folder: "proof" },
  { field: "sign_images", mediaType: "SIGNATURE_IMAGE", folder: "sign" },
  { field: "reschedule_images", mediaType: "POSTPONE_IMAGE", folder: "reschedule" },
  { field: "return_images", mediaType: "RETURN_IMAGE", folder: "return" },
];

const getSerialNos = (value) => {
  const values = Array.isArray(value) ? value : (() => {
    try {
      return JSON.parse(String(value || "[]"));
    } catch {
      return [];
    }
  })();

  if (!Array.isArray(values)) return [];

  return [...new Set(values.map((serialNo) => String(serialNo || "").trim()).filter(Boolean))].slice(0, 1000);
};

const getImageExtension = (file) => {
  const extension = path.extname(file.originalname || "").toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(extension)) return extension;
  return file.mimetype === "image/png" ? ".png" : file.mimetype === "image/webp" ? ".webp" : ".jpg";
};

const getUploadedFiles = (req, field) => (Array.isArray(req.files?.[field]) ? req.files[field] : []);

const uniqueMedia = (media) => {
  const paths = new Set();
  return media.filter((item) => {
    if (paths.has(item.preview)) return false;
    paths.add(item.preview);
    return true;
  });
};

const getTruckStatus = (items) => {
  if (!items.length) return "PENDING_CLOSE";

  const statuses = items.map((item) => item.delivery_status || "PENDING_CLOSE");

  if (statuses.every((status) => status === "COMPLETED")) return "COMPLETED";
  if (statuses.every((status) => status === "RETURN_TO_SHIPPER")) return "RETURN_TO_SHIPPER";
  if (statuses.some((status) => status === "POSTPONED")) return "POSTPONED";

  return "PENDING_CLOSE";
};

export const getDeliveryCompletes = async (req, res) => {
  try {
    const page = getPositiveInteger(req.query.page, 1, Number.MAX_SAFE_INTEGER);
    const limit = getPositiveInteger(req.query.limit, 50, 100);
    const search = cleanDbText(req.query.search)?.slice(0, 200) || null;

    const whereParts = [
      "receive.truck_status = 'DC_TRUCK'",
      "receive.is_close = 'Y'",
      "receive.is_go = 'Y'",
    ];
    const whereParams = [];

    if (search) {
      const searchValue = `%${search}%`;
      whereParts.push(`(
        receive.receive_code LIKE ?
        OR COALESCE(receive.reference_no, '') LIKE ?
        OR receive.serial_no LIKE ?
        OR COALESCE(receive.recipient_name, '') LIKE ?
        OR COALESCE(receive.route_code, '') LIKE ?
        OR COALESCE(receive.route_name, '') LIKE ?
      )`);
      whereParams.push(...Array(6).fill(searchValue));
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
    const offset = (page - 1) * limit;

    const [[countRow]] = await db.query(
      `
        SELECT COUNT(*) AS total_items
        FROM (
          SELECT receive.receive_business_id, receive.receive_walkin_id, receive.receive_code
          FROM vw_delivery_receive_serials receive
          ${whereSql}
          GROUP BY receive.receive_business_id, receive.receive_walkin_id, receive.receive_code
        ) bills
      `,
      whereParams,
    );

    const [billRows] = await db.query(
      `
        SELECT
          receive.receive_business_id,
          receive.receive_walkin_id,
          receive.receive_code,
          MIN(receive.reference_no) AS reference_no,
          MIN(receive.delivery_date) AS delivery_date,
          MIN(receive.route_id) AS route_id,
          MIN(receive.route_code) AS route_code,
          MIN(receive.route_name) AS route_name,
          MAX(receive.truck_load_id) AS truck_load_id,
          GROUP_CONCAT(DISTINCT NULLIF(receive.truck_code, '') ORDER BY receive.truck_code SEPARATOR ', ') AS truck_code,
          GROUP_CONCAT(DISTINCT NULLIF(receive.driver_name, '') ORDER BY receive.driver_name SEPARATOR ', ') AS driver_name,
          GROUP_CONCAT(DISTINCT NULLIF(receive.license_plate, '') ORDER BY receive.license_plate SEPARATOR ', ') AS license_plate,
          GROUP_CONCAT(DISTINCT NULLIF(receive.license_plate_province, '') ORDER BY receive.license_plate_province SEPARATOR ', ') AS license_plate_province,
          GROUP_CONCAT(DISTINCT NULLIF(receive.truck_route_code, '') ORDER BY receive.truck_route_code SEPARATOR ', ') AS truck_route_code,
          GROUP_CONCAT(DISTINCT NULLIF(receive.truck_route_name, '') ORDER BY receive.truck_route_name SEPARATOR ', ') AS truck_route_name,
          MAX(receive.go_datetime) AS go_datetime,
          MAX(receive.close_datetime) AS close_datetime
        FROM vw_delivery_receive_serials receive
        ${whereSql}
        GROUP BY receive.receive_business_id, receive.receive_walkin_id, receive.receive_code
        ORDER BY MIN(receive.receive_date) DESC, receive.receive_code DESC
        LIMIT ? OFFSET ?
      `,
      [...whereParams, limit, offset],
    );

    if (!billRows.length) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: { page, limit, total_items: Number(countRow.total_items || 0) },
      });
    }

    const billCondition = billRows
      .map(() => "(receive.receive_business_id <=> ? AND receive.receive_walkin_id <=> ? AND receive.receive_code = ?)")
      .join(" OR ");
    const billParams = billRows.flatMap((bill) => [bill.receive_business_id, bill.receive_walkin_id, bill.receive_code]);
    const [itemRows] = await db.query(
      `
        SELECT
          receive.receive_business_id,
          receive.receive_walkin_id,
          receive.receive_code,
          receive.reference_no,
          receive.serial_id,
          receive.serial_no,
          receive.recipient_name,
          receive.recipient_detail_name,
          receive.full_address,
          receive.cod,
          delivery_status.delivery_status_id,
          COALESCE(delivery_status.delivery_status, 'PENDING_CLOSE') AS delivery_status,
          delivery_status.status_note,
          delivery_status.issue_type,
          delivery_status.next_delivery_date,
          delivery_status.delivered_datetime
        FROM vw_delivery_receive_serials receive
        LEFT JOIN tm_delivery_statuses delivery_status
          ON delivery_status.delivery_status_id = (
            SELECT latest_status.delivery_status_id
            FROM tm_delivery_statuses latest_status
            WHERE latest_status.serial_id = receive.serial_id
            ORDER BY COALESCE(latest_status.updated_date, latest_status.created_date) DESC, latest_status.delivery_status_id DESC
            LIMIT 1
          )
        WHERE ${billCondition}
        ORDER BY receive.receive_code, receive.serial_no
      `,
      billParams,
    );

    const statusIds = [...new Set(itemRows.map((item) => item.delivery_status_id).filter(Boolean))];
    const [mediaRows] = statusIds.length
      ? await db.query(
        `
          SELECT delivery_status_id, media_type, file_name, file_path
          FROM tm_delivery_status_media
          WHERE delivery_status_id IN (${statusIds.map(() => "?").join(", ")})
          ORDER BY delivery_status_media_id
        `,
        statusIds,
      )
      : [[]];
    const mediaByStatusId = new Map();
    for (const media of mediaRows) {
      const statusMedia = mediaByStatusId.get(media.delivery_status_id) || [];
      statusMedia.push({ name: media.file_name, preview: media.file_path, media_type: media.media_type });
      mediaByStatusId.set(media.delivery_status_id, statusMedia);
    }

    const itemsByBillKey = new Map();
    for (const item of itemRows) {
      item.media = mediaByStatusId.get(item.delivery_status_id) || [];
      const billKey = `${item.receive_business_id ?? ""}:${item.receive_walkin_id ?? ""}:${item.receive_code}`;
      const items = itemsByBillKey.get(billKey) || [];
      items.push(item);
      itemsByBillKey.set(billKey, items);
    }

    const data = billRows.map((bill) => {
      const billKey = `${bill.receive_business_id ?? ""}:${bill.receive_walkin_id ?? ""}:${bill.receive_code}`;
      const items = itemsByBillKey.get(billKey) || [];
      const deliveredItems = items.filter((item) => item.delivery_status === "COMPLETED");
      const postponedItem = items.find((item) => item.delivery_status === "POSTPONED");
      const proofImages = uniqueMedia(items.flatMap((item) => item.media.filter((media) => media.media_type === "PROOF_IMAGE")));
      const signatureImages = uniqueMedia(items.flatMap((item) => item.media.filter((media) => media.media_type === "SIGNATURE_IMAGE")));
      const postponeImages = uniqueMedia(items.flatMap((item) => item.media.filter((media) => media.media_type === "POSTPONE_IMAGE")));
      const latestCompletedItem = deliveredItems
        .filter((item) => item.delivered_datetime)
        .sort((left, right) => new Date(right.delivered_datetime) - new Date(left.delivered_datetime))[0];

      return {
        id: billKey,
        receive_business_id: bill.receive_business_id,
        receive_walkin_id: bill.receive_walkin_id,
        truck_load_id: bill.truck_load_id,
        truck_code: bill.truck_code || "-",
        route_id: bill.route_id,
        route_code: bill.truck_route_code || bill.route_code || "-",
        route_name: bill.truck_route_name || bill.route_name || "-",
        driver_name: bill.driver_name || "-",
        operator_name: "-",
        license_plate: bill.license_plate || "-",
        license_plate_province: bill.license_plate_province || "-",
        departure_at: bill.go_datetime || bill.close_datetime || bill.delivery_date,
        bill_no: bill.receive_code,
        reference_no: bill.reference_no || "-",
        serial_numbers: items.map((item) => item.serial_no),
        delivered_serial_numbers: deliveredItems.map((item) => item.serial_no),
        status: getTruckStatus(items),
        status_note: postponedItem?.status_note || null,
        next_delivery_date: postponedItem?.next_delivery_date || null,
        completed_at: latestCompletedItem?.delivered_datetime || null,
        proof_images: proofImages,
        signature_images: signatureImages,
        postpone_images: postponeImages,
        items,
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

export const saveDeliveryCompleteStatuses = async (req, res) => {
  let connection;
  let transactionStarted = false;
  const createdFiles = [];

  try {
    const truckLoadId = toNumberOrNull(req.params.truckLoadId);
    const warehouseId = getWarehouseId(req);
    const actorId = getActorId(req);
    const deliveryStatus = String(req.body.delivery_status || "").trim().toUpperCase();
    const requestedSerialNos = getSerialNos(req.body.serial_nos);
    const statusNote = cleanDbText(req.body.status_note)?.slice(0, 500) || null;
    const issueType = cleanDbText(req.body.issue_type)?.slice(0, 100) || null;
    const requestedCompletedAt = cleanDbText(req.body.delivered_datetime);
    const requestedNextDeliveryDate = cleanDbText(req.body.next_delivery_date);
    const date = new Date();
    const completedAt = requestedCompletedAt && !Number.isNaN(new Date(requestedCompletedAt).getTime())
      ? new Date(requestedCompletedAt)
      : date;
    const nextDeliveryDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedNextDeliveryDate || "") ? requestedNextDeliveryDate : null;
    const proofFiles = getUploadedFiles(req, "proof_images");
    const signFiles = getUploadedFiles(req, "sign_images");

    if (!truckLoadId || !warehouseId || !actorId || !DELIVERY_STATUS_VALUES.has(deliveryStatus)) {
      return res.status(400).json({ success: false, message: "ข้อมูลบันทึกผลจัดส่งไม่ถูกต้อง" });
    }

    if (deliveryStatus === "COMPLETED" && (!requestedSerialNos.length || !proofFiles.length || !signFiles.length)) {
      return res.status(400).json({ success: false, message: "กรุณาเลือก Serial No พร้อมรูปหลักฐานและลายเซ็น" });
    }

    if (deliveryStatus === "POSTPONED" && !nextDeliveryDate) {
      return res.status(400).json({ success: false, message: "กรุณาระบุวันจัดส่งใหม่" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [truckRows] = await connection.query(
      `
        SELECT id
        FROM tm_trucks
        WHERE id = ?
          AND status = 'DC_TRUCK'
          AND warehouse_id = ?
          AND is_close = 'Y'
          AND is_go = 'Y'
          AND COALESCE(is_deleted, 'N') = 'N'
        LIMIT 1
        FOR UPDATE
      `,
      [truckLoadId, warehouseId],
    );

    if (!truckRows.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ success: false, message: "ไม่พบใบรถกระจายที่กำลังจัดส่ง" });
    }

    const [productRows] = await connection.query(
      `
        SELECT serial_id, serial_no
        FROM tm_product_trucks
        WHERE truck_load_id = ?
        ORDER BY id
        FOR UPDATE
      `,
      [truckLoadId],
    );
    const [existingStatusRows] = await connection.query(
      `
        SELECT delivery_status_id, serial_id, serial_no, delivery_status
        FROM tm_delivery_statuses
        WHERE truck_load_id = ?
        FOR UPDATE
      `,
      [truckLoadId],
    );
    const productsBySerialNo = new Map(productRows.map((product) => [String(product.serial_no), product]));
    const completedSerialNos = new Set(
      existingStatusRows
        .filter((status) => status.delivery_status === "COMPLETED")
        .map((status) => String(status.serial_no)),
    );
    const targetSerialNos = requestedSerialNos.length
      ? requestedSerialNos
      : productRows.map((product) => String(product.serial_no)).filter((serialNo) => !completedSerialNos.has(serialNo));
    const targets = targetSerialNos.map((serialNo) => productsBySerialNo.get(serialNo)).filter(Boolean);

    if (targets.length !== targetSerialNos.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(400).json({ success: false, message: "พบ Serial No ที่ไม่ได้อยู่ในใบรถกระจายนี้" });
    }

    if (!targets.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({ success: false, message: "ไม่มีรายการที่สามารถบันทึกผลจัดส่งได้" });
    }

    for (const product of targets) {
      await connection.query(
        `
          INSERT INTO tm_delivery_statuses (
            truck_load_id, serial_id, serial_no, delivery_status,
            status_note, issue_type, next_delivery_date, delivered_datetime,
            created_by, created_date, updated_by, updated_date
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            delivery_status = VALUES(delivery_status),
            status_note = VALUES(status_note),
            issue_type = VALUES(issue_type),
            next_delivery_date = VALUES(next_delivery_date),
            delivered_datetime = VALUES(delivered_datetime),
            updated_by = VALUES(updated_by),
            updated_date = VALUES(updated_date)
        `,
        [
          truckLoadId,
          product.serial_id,
          product.serial_no,
          deliveryStatus,
          statusNote,
          issueType,
          deliveryStatus === "POSTPONED" ? nextDeliveryDate : null,
          deliveryStatus === "COMPLETED" ? completedAt : null,
          actorId,
          date,
          actorId,
          date,
        ],
      );
    }

    const statusPlaceholders = targets.map(() => "?").join(", ");
    const [statusRows] = await connection.query(
      `
        SELECT delivery_status_id, serial_no
        FROM tm_delivery_statuses
        WHERE truck_load_id = ?
          AND serial_no IN (${statusPlaceholders})
      `,
      [truckLoadId, ...targets.map((product) => product.serial_no)],
    );

    for (const statusRow of statusRows) {
      for (const mediaField of MEDIA_FIELDS) {
        for (const file of getUploadedFiles(req, mediaField.field)) {
          const relativeDirectory = path.posix.join(
            "delivery-completes",
            String(truckLoadId),
            String(statusRow.delivery_status_id),
            mediaField.folder,
          );
          const absoluteDirectory = path.join(uploadsDirectory, ...relativeDirectory.split("/"));
          const fileName = `${randomUUID()}${getImageExtension(file)}`;
          const absolutePath = path.join(absoluteDirectory, fileName);
          const filePath = `/uploads/${relativeDirectory}/${fileName}`;

          await fs.mkdir(absoluteDirectory, { recursive: true });
          await fs.writeFile(absolutePath, file.buffer);
          createdFiles.push(absolutePath);
          await connection.query(
            `
              INSERT INTO tm_delivery_status_media (
                delivery_status_id, media_type, file_name, file_path,
                mime_type, file_size, created_by, created_date
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [statusRow.delivery_status_id, mediaField.mediaType, fileName, filePath, file.mimetype, file.size, actorId, date],
          );
        }
      }
    }

    await connection.commit();
    transactionStarted = false;

    return res.status(200).json({
      success: true,
      message: "บันทึกผลจัดส่งสำเร็จ",
      data: {
        truck_load_id: truckLoadId,
        delivery_status: deliveryStatus,
        serial_nos: targets.map((product) => product.serial_no),
      },
    });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    await Promise.all(createdFiles.map((filePath) => fs.unlink(filePath).catch(() => undefined)));
    console.error("saveDeliveryCompleteStatuses error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถบันทึกผลจัดส่งได้" });
  } finally {
    connection?.release();
  }
};
