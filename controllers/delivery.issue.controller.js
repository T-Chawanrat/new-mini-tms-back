import db from "../config/db.js";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { cleanDbText, toNumberOrNull } from "../utils/cleanText.js";

const uploadsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../uploads");
const actorIdOf = (req) => toNumberOrNull(req.user?.id ?? req.user?.user_id);
const safeFolder = (value) =>
  String(value || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 80);
const imageExtension = (file) => ({ "image/png": ".png", "image/webp": ".webp" })[file.mimetype] || ".jpg";
const imageFiles = (req) => (Array.isArray(req.files?.images) ? req.files.images : []);
const thumbnailPathOf = (filePath) => {
  const parsed = path.posix.parse(filePath);
  return `${parsed.dir}/${parsed.name}.thumb.webp`;
};
const writeChatThumbnail = (source, destination) =>
  sharp(source).rotate().resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true }).webp({ quality: 68 }).toFile(destination);

export const createDeliveryIssue = async (req, res) => {
  try {
    const actorId = actorIdOf(req);
    const receiveCode = cleanDbText(req.params.receiveCode)?.slice(0, 50);
    const receiveBusinessId = toNumberOrNull(req.body?.receive_business_id);
    const receiveWalkinId = toNumberOrNull(req.body?.receive_walkin_id);
    const issueType = cleanDbText(req.body?.issue_type)?.slice(0, 100) || "แจ้งปัญหาการจัดส่ง";
    if (!actorId || !receiveCode || (receiveBusinessId === null && receiveWalkinId === null))
      return res.status(400).json({ success: false, message: "ข้อมูลบิลไม่ถูกต้อง" });
    const [[existing]] = await db.query(
      `SELECT delivery_issue_id FROM tm_delivery_issues
       WHERE receive_code = ? AND receive_business_id <=> ? AND receive_walkin_id <=> ? LIMIT 1`,
      [receiveCode, receiveBusinessId, receiveWalkinId],
    );
    if (existing) return res.status(200).json({ success: true, data: { delivery_issue_id: existing.delivery_issue_id, created: false } });
    const [[bill]] = await db.query(
      `SELECT 1 FROM tm_receive_serials
       WHERE receive_code = ? AND receive_business_id <=> ? AND receive_walkin_id <=> ? LIMIT 1`,
      [receiveCode, receiveBusinessId, receiveWalkinId],
    );
    if (!bill) return res.status(404).json({ success: false, message: "ไม่พบเลขที่บิล" });
    const now = new Date();
    const [result] = await db.query(
      `INSERT INTO tm_delivery_issues (
         receive_business_id, receive_walkin_id, receive_code,
         issue_type, issue_status, created_by, created_date, updated_by, updated_date
       ) VALUES (?, ?, ?, ?, 'NEW', ?, ?, ?, ?)`,
      [receiveBusinessId, receiveWalkinId, receiveCode, issueType, actorId, now, actorId, now],
    );
    return res.status(201).json({ success: true, data: { delivery_issue_id: result.insertId, created: true } });
  } catch (error) {
    console.error("createDeliveryIssue error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถสร้างเคสแจ้งปัญหาได้" });
  }
};

export const getDeliveryIssueThreads = async (req, res) => {
  try {
    const actorId = actorIdOf(req);
    const [rows] = await db.query(
      `SELECT
         issue.receive_code,
         issue.issue_type,
         issue.issue_status,
         TRIM(CONCAT_WS(' ', NULLIF(driver.first_name, ''), NULLIF(driver.last_name, ''))) AS driver_name,
         MAX(COALESCE(message.created_date, issue.updated_date, issue.created_date)) AS updated_at,
         SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(NULLIF(message.message_text, ''), 'แนบรูปภาพ') ORDER BY message.created_date DESC SEPARATOR '\u001f'), '\u001f', 1) AS last_message,
         SUM(CASE WHEN message.sender_user_id <> ? AND message_read.delivery_status_message_id IS NULL THEN 1 ELSE 0 END) AS unread_count
       FROM tm_delivery_issues issue
       LEFT JOIN um_users driver ON driver.id = issue.created_by
       LEFT JOIN tm_delivery_messages message ON message.delivery_issue_id = issue.delivery_issue_id
       LEFT JOIN tm_delivery_message_reads message_read
         ON message_read.delivery_status_message_id = message.delivery_status_message_id AND message_read.user_id = ?
       WHERE issue.receive_code IS NOT NULL AND TRIM(issue.receive_code) <> ''
       GROUP BY issue.delivery_issue_id, issue.receive_code, issue.issue_type, issue.issue_status, driver.first_name, driver.last_name
       ORDER BY updated_at DESC`,
      [actorId, actorId],
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getDeliveryIssueThreads error:", error);
    res.status(500).json({ success: false, message: "ไม่สามารถโหลดรายการแชทได้" });
  }
};

export const getDeliveryIssueMessages = async (req, res) => {
  const actorId = actorIdOf(req);
  const receiveCode = cleanDbText(req.params.receiveCode)?.slice(0, 50);
  if (!actorId || !receiveCode) return res.status(400).json({ success: false, message: "receive_code ไม่ถูกต้อง" });
  const now = new Date();
  try {
    const [[bill]] = await db.query(
      `SELECT issue.delivery_issue_id, issue.receive_code, issue.issue_type, issue.issue_status, MAX(receive_serial.recipient_name) AS recipient_name
       FROM tm_delivery_issues issue
       LEFT JOIN tm_receive_serials receive_serial
         ON receive_serial.receive_code = issue.receive_code
        AND receive_serial.receive_business_id <=> issue.receive_business_id
        AND receive_serial.receive_walkin_id <=> issue.receive_walkin_id
       WHERE issue.receive_code = ?
       GROUP BY issue.delivery_issue_id, issue.receive_code, issue.issue_type, issue.issue_status`,
      [receiveCode],
    );
    if (!bill) return res.status(404).json({ success: false, message: "ไม่พบเลขที่บิล" });

    const [messages] = await db.query(
      `SELECT message.delivery_status_message_id, message.sender_user_id, message.message_text, message.created_date,
              TRIM(CONCAT_WS(' ', NULLIF(sender.first_name, ''), NULLIF(sender.last_name, ''))) AS sender_name, sender.username
       FROM tm_delivery_messages message
       LEFT JOIN um_users sender ON sender.id = message.sender_user_id
       WHERE message.delivery_issue_id = ?
       ORDER BY message.created_date, message.delivery_status_message_id`,
      [bill.delivery_issue_id],
    );
    const ids = messages.map((message) => message.delivery_status_message_id);
    const [media] = ids.length
      ? await db.query(
          `SELECT delivery_status_message_id, file_name, file_path, mime_type FROM tm_delivery_message_media WHERE delivery_status_message_id IN (${ids.map(() => "?").join(", ")}) ORDER BY delivery_status_message_media_id`,
          ids,
        )
      : [[]];
    const mediaWithThumbnails = await Promise.all(
      media.map(async (item) => {
        const thumbnailPath = thumbnailPathOf(item.file_path);
        const thumbnailAbsolutePath = path.join(uploadsDirectory, ...thumbnailPath.replace(/^\/uploads\//, "").split("/"));
        const sourceAbsolutePath = path.join(uploadsDirectory, ...item.file_path.replace(/^\/uploads\//, "").split("/"));
        try {
          const metadata = await sharp(thumbnailAbsolutePath).metadata();
          if ((metadata.width || 0) > 320 || (metadata.height || 0) > 320) await writeChatThumbnail(sourceAbsolutePath, thumbnailAbsolutePath);
          return { ...item, thumbnail_path: thumbnailPath };
        } catch {
          try {
            await fs.access(sourceAbsolutePath);
            await writeChatThumbnail(sourceAbsolutePath, thumbnailAbsolutePath);
            return { ...item, thumbnail_path: thumbnailPath };
          } catch {
            return { ...item, thumbnail_path: null };
          }
        }
      }),
    );
    const mediaByMessage = new Map();
    for (const item of mediaWithThumbnails)
      mediaByMessage.set(item.delivery_status_message_id, [...(mediaByMessage.get(item.delivery_status_message_id) || []), item]);
    if (ids.length) {
      await db.query(
        `INSERT IGNORE INTO tm_delivery_message_reads (delivery_status_message_id, user_id, read_date)
         SELECT delivery_status_message_id, ?, ? FROM tm_delivery_messages WHERE delivery_issue_id = ? AND sender_user_id <> ?`,
        [actorId, now, bill.delivery_issue_id, actorId],
      );
    }
    res.json({
      success: true,
      data: {
        thread: {
          receive_code: bill.receive_code,
          issue_type: bill.issue_type,
          issue_status: bill.issue_status,
          recipient_name: bill.recipient_name || "-",
        },
        messages: messages.map((message) => ({
          ...message,
          sender_name: message.sender_name || message.username || "-",
          media: mediaByMessage.get(message.delivery_status_message_id) || [],
        })),
      },
    });
  } catch (error) {
    console.error("getDeliveryIssueMessages error:", error);
    res.status(500).json({ success: false, message: "ไม่สามารถโหลดข้อความได้" });
  }
};

export const createDeliveryIssueMessage = async (req, res) => {
  let connection;
  const createdFiles = [];
  const actorId = actorIdOf(req);
  const receiveCode = cleanDbText(req.params.receiveCode)?.slice(0, 50);
  const messageText = cleanDbText(req.body.message_text)?.slice(0, 10000) || null;
  const files = imageFiles(req);
  if (!actorId || !receiveCode || (!messageText && !files.length))
    return res.status(400).json({ success: false, message: "กรุณาระบุข้อความหรือรูปภาพ" });
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const now = new Date();
    const [[issue]] = await connection.query(`SELECT delivery_issue_id FROM tm_delivery_issues WHERE receive_code = ? LIMIT 1`, [receiveCode]);
    if (!issue) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "ไม่พบเคสแจ้งปัญหานี้" });
    }
    const [result] = await connection.query(
      `INSERT INTO tm_delivery_messages (delivery_issue_id, sender_user_id, message_text, created_date) VALUES (?, ?, ?, ?)`,
      [issue.delivery_issue_id, actorId, messageText, now],
    );
    const messageId = result.insertId;
    const relativeDirectory = path.posix.join("delivery-issues", safeFolder(receiveCode), "chat");
    const absoluteDirectory = path.join(uploadsDirectory, ...relativeDirectory.split("/"));
    await fs.mkdir(absoluteDirectory, { recursive: true });
    for (const file of files) {
      const fileName = `${randomUUID().replace(/-/g, "").slice(0, 16)}${imageExtension(file)}`;
      const thumbnailName = `${path.parse(fileName).name}.thumb.webp`;
      const absolutePath = path.join(absoluteDirectory, fileName);
      const thumbnailAbsolutePath = path.join(absoluteDirectory, thumbnailName);
      const filePath = `/uploads/${relativeDirectory}/${fileName}`;
      await fs.writeFile(absolutePath, file.buffer);
      createdFiles.push(absolutePath);
      await writeChatThumbnail(file.buffer, thumbnailAbsolutePath);
      createdFiles.push(thumbnailAbsolutePath);
      await connection.query(
        `INSERT INTO tm_delivery_message_media (delivery_status_message_id, file_name, file_path, mime_type, file_size, created_by, created_date) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [messageId, fileName, filePath, file.mimetype, file.size, actorId, now],
      );
    }
    await connection.commit();
    res.status(201).json({ success: true, data: { delivery_status_message_id: messageId } });
  } catch (error) {
    await connection?.rollback();
    await Promise.all(createdFiles.map((file) => fs.unlink(file).catch(() => undefined)));
    console.error("createDeliveryIssueMessage error:", error);
    res.status(500).json({ success: false, message: "ไม่สามารถส่งข้อความได้" });
  } finally {
    connection?.release();
  }
};

export const updateDeliveryIssueStatus = async (req, res) => {
  try {
    const actorId = actorIdOf(req);
    const receiveCode = cleanDbText(req.params.receiveCode)?.slice(0, 50);
    const issueStatus = cleanDbText(req.body?.issue_status)?.toUpperCase();
    if (!actorId || !receiveCode || !["NEW", "IN_PROGRESS", "RESOLVED"].includes(issueStatus))
      return res.status(400).json({ success: false, message: "สถานะไม่ถูกต้อง" });
    const [result] = await db.query(`UPDATE tm_delivery_issues SET issue_status = ?, updated_by = ?, updated_date = ? WHERE receive_code = ?`, [
      issueStatus,
      actorId,
      new Date(),
      receiveCode,
    ]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "ไม่พบเคสแจ้งปัญหา" });
    return res.json({ success: true, data: { issue_status: issueStatus } });
  } catch (error) {
    console.error("updateDeliveryIssueStatus error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถเปลี่ยนสถานะได้" });
  }
};
