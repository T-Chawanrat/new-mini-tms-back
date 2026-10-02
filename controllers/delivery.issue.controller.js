import db from "../config/db.js";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { cleanDbText, toNumberOrNull } from "../utils/cleanText.js";

const uploadsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../uploads");
const actorIdOf = (req) => toNumberOrNull(req.user?.id ?? req.user?.user_id);
const safeFolder = (value) =>
  String(value || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 80);
const imageExtension = (file) => ({ "image/png": ".png", "image/webp": ".webp" })[file.mimetype] || ".jpg";
const imageFiles = (req) => (Array.isArray(req.files?.images) ? req.files.images : []);

export const getDeliveryIssueThreads = async (req, res) => {
  try {
    const actorId = actorIdOf(req);
    const [rows] = await db.query(
      `SELECT
         message.receive_code,
         'แชทแจ้งปัญหาการจัดส่ง' AS title,
         MAX(message.created_date) AS updated_at,
         SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(NULLIF(message.message_text, ''), 'แนบรูปภาพ') ORDER BY message.created_date DESC SEPARATOR '\u001f'), '\u001f', 1) AS last_message,
         SUM(CASE WHEN message.sender_user_id <> ? AND message_read.delivery_status_message_id IS NULL THEN 1 ELSE 0 END) AS unread_count
       FROM tm_delivery_status_messages message
       LEFT JOIN tm_delivery_status_message_reads message_read
         ON message_read.delivery_status_message_id = message.delivery_status_message_id AND message_read.user_id = ?
       WHERE message.receive_code IS NOT NULL AND TRIM(message.receive_code) <> ''
       GROUP BY message.receive_code
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
      `SELECT receive_code, MAX(recipient_name) AS recipient_name FROM tm_receive_serials WHERE receive_code = ? GROUP BY receive_code`,
      [receiveCode],
    );
    if (!bill) return res.status(404).json({ success: false, message: "ไม่พบเลขที่บิล" });

    const [messages] = await db.query(
      `SELECT message.delivery_status_message_id, message.sender_user_id, message.message_text, message.created_date,
              TRIM(CONCAT_WS(' ', NULLIF(sender.first_name, ''), NULLIF(sender.last_name, ''))) AS sender_name, sender.username
       FROM tm_delivery_status_messages message
       LEFT JOIN um_users sender ON sender.id = message.sender_user_id
       WHERE message.receive_code = ?
       ORDER BY message.created_date, message.delivery_status_message_id`,
      [receiveCode],
    );
    const ids = messages.map((message) => message.delivery_status_message_id);
    const [media] = ids.length
      ? await db.query(
          `SELECT delivery_status_message_id, file_name, file_path, mime_type FROM tm_delivery_status_message_media WHERE delivery_status_message_id IN (${ids.map(() => "?").join(", ")}) ORDER BY delivery_status_message_media_id`,
          ids,
        )
      : [[]];
    const mediaByMessage = new Map();
    for (const item of media)
      mediaByMessage.set(item.delivery_status_message_id, [...(mediaByMessage.get(item.delivery_status_message_id) || []), item]);
    if (ids.length) {
      await db.query(
        `INSERT IGNORE INTO tm_delivery_status_message_reads (delivery_status_message_id, user_id, read_date)
         SELECT delivery_status_message_id, ?, ? FROM tm_delivery_status_messages WHERE receive_code = ? AND sender_user_id <> ?`,
        [actorId, now, receiveCode, actorId],
      );
    }
    res.json({
      success: true,
      data: {
        thread: { receive_code: bill.receive_code, title: "แชทแจ้งปัญหาการจัดส่ง", recipient_name: bill.recipient_name || "-" },
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
    const [[bill]] = await connection.query(`SELECT 1 FROM tm_receive_serials WHERE receive_code = ? LIMIT 1`, [receiveCode]);
    if (!bill) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "ไม่พบเลขที่บิล" });
    }
    const [result] = await connection.query(
      `INSERT INTO tm_delivery_status_messages (truck_load_id, receive_code, delivery_status_id, sender_user_id, message_text, created_date) VALUES (NULL, ?, NULL, ?, ?, ?)`,
      [receiveCode, actorId, messageText, now],
    );
    const messageId = result.insertId;
    const relativeDirectory = path.posix.join("delivery-issues", safeFolder(receiveCode), "chat");
    const absoluteDirectory = path.join(uploadsDirectory, ...relativeDirectory.split("/"));
    for (const file of files) {
      const fileName = `${randomUUID().replace(/-/g, "").slice(0, 16)}${imageExtension(file)}`;
      const absolutePath = path.join(absoluteDirectory, fileName);
      const filePath = `/uploads/${relativeDirectory}/${fileName}`;
      await fs.mkdir(absoluteDirectory, { recursive: true });
      await fs.writeFile(absolutePath, file.buffer);
      createdFiles.push(absolutePath);
      await connection.query(
        `INSERT INTO tm_delivery_status_message_media (delivery_status_message_id, file_name, file_path, mime_type, file_size, created_by, created_date) VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
