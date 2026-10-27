import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import db from "../../config/db.js";
import { cleanText, toNumberOrNull } from "../../utils/input.js";
import { emitDeliveryIssue, emitDeliveryIssueInbox, emitDriverDeliveryIssueInbox } from "../../services/realtime/socket.js";

const uploadsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../uploads");
const inputError = (message, status = 400) => Object.assign(new Error(message), { status });
const uploadedImages = (req) => {
  if (Array.isArray(req.files)) return req.files;
  return Array.isArray(req.files?.images) ? req.files.images : [];
};

const requireDriverBill = async (connection, { driverId, receiveBusinessId = null, receiveWalkinId = null }) => {
  const conditions = ["truck.user_truck_id = ?"];
  const params = [driverId];
  if (receiveBusinessId !== null) {
    conditions.push("receive_serial.receive_business_id <=> ?");
    params.push(receiveBusinessId);
  }
  if (receiveWalkinId !== null) {
    conditions.push("receive_serial.receive_walkin_id <=> ?");
    params.push(receiveWalkinId);
  }
  const [[row]] = await connection.query(
    `SELECT receive_serial.receive_business_id, receive_serial.receive_walkin_id, receive_serial.receive_code
     FROM tm_receive_serials receive_serial
     INNER JOIN tm_product_trucks product
       ON product.serial_id = receive_serial.serial_id AND product.serial_no = receive_serial.serial_no
     INNER JOIN tm_trucks truck ON truck.id = product.truck_load_id
     WHERE ${conditions.join(" AND ")}
     LIMIT 1`,
    params,
  );
  if (!row) throw inputError("ไม่พบสิทธิ์เข้าถึงบิลนี้", 404);
  return row;
};

const findDriverIssue = async (connection, driverId, issueId) => {
  const [[issue]] = await connection.query(
    `SELECT issue.delivery_issue_id, issue.receive_code, issue.issue_type, issue.issue_status,
            MAX(receive_serial.recipient_name) AS recipient_name
     FROM tm_delivery_issues issue
     INNER JOIN tm_receive_serials receive_serial
       ON receive_serial.receive_business_id <=> issue.receive_business_id
      AND receive_serial.receive_walkin_id <=> issue.receive_walkin_id
     INNER JOIN tm_product_trucks product
       ON product.serial_id = receive_serial.serial_id AND product.serial_no = receive_serial.serial_no
     INNER JOIN tm_trucks truck ON truck.id = product.truck_load_id
     WHERE issue.delivery_issue_id = ? AND truck.user_truck_id = ?
     GROUP BY issue.delivery_issue_id, issue.receive_code, issue.issue_type, issue.issue_status
     LIMIT 1`,
    [issueId, driverId],
  );
  if (!issue) throw inputError("ไม่พบเคสแจ้งปัญหานี้", 404);
  return issue;
};

export const getDriverDeliveryIssueReasons = async (_req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT reason_send_problem_id, reason_send_problem_detail
       FROM mm_reason_send_problems
       WHERE reason_send_problem_detail IS NOT NULL AND TRIM(reason_send_problem_detail) <> ''
       ORDER BY reason_send_problem_id`,
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getDriverDeliveryIssueReasons error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดข้อความด่วนได้" });
  }
};

export const getDriverDeliveryIssueByReceive = async (req, res) => {
  try {
    const driverId = toNumberOrNull(req.user?.id);
    const receiveBusinessId = toNumberOrNull(req.query?.receive_business_id);
    const receiveWalkinId = toNumberOrNull(req.query?.receive_walkin_id);
    if (!driverId || (receiveBusinessId === null) === (receiveWalkinId === null)) throw inputError("ข้อมูลบิลไม่ถูกต้อง");

    const bill = await requireDriverBill(db, { driverId, receiveBusinessId, receiveWalkinId });
    const [[issue]] = await db.query(
      `SELECT delivery_issue_id
       FROM tm_delivery_issues
       WHERE receive_business_id <=> ? AND receive_walkin_id <=> ?
       LIMIT 1`,
      [bill.receive_business_id, bill.receive_walkin_id],
    );
    return res.json({ success: true, data: issue || null });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "ไม่สามารถค้นหาแชทของบิลนี้ได้" });
  }
};

export const getDriverDeliveryIssueThreads = async (req, res) => {
  try {
    const driverId = toNumberOrNull(req.user?.id);
    if (!driverId) throw inputError("ข้อมูลผู้ขับรถไม่ถูกต้อง");
    const [rows] = await db.query(
      `SELECT
         issue.delivery_issue_id,
         issue.receive_code,
         issue.issue_type,
         issue.issue_status,
         (
           SELECT MAX(receive_serial.recipient_name)
           FROM tm_receive_serials receive_serial
           WHERE receive_serial.receive_business_id <=> issue.receive_business_id
             AND receive_serial.receive_walkin_id <=> issue.receive_walkin_id
         ) AS recipient_name,
         MAX(COALESCE(message.created_date, issue.updated_date, issue.created_date)) AS updated_at,
         (
           SELECT COALESCE(NULLIF(latest_message.message_text, ''), 'แนบรูปภาพ')
           FROM tm_delivery_messages latest_message
           WHERE latest_message.delivery_issue_id = issue.delivery_issue_id
           ORDER BY latest_message.created_date DESC, latest_message.delivery_status_message_id DESC
           LIMIT 1
         ) AS last_message,
         SUM(CASE WHEN message.sender_user_id <> ? AND message_read.delivery_status_message_id IS NULL THEN 1 ELSE 0 END) AS unread_count
       FROM tm_delivery_issues issue
       LEFT JOIN tm_delivery_messages message ON message.delivery_issue_id = issue.delivery_issue_id
       LEFT JOIN tm_delivery_message_reads message_read
         ON message_read.delivery_status_message_id = message.delivery_status_message_id
        AND message_read.user_id = ?
       WHERE EXISTS (
         SELECT 1
         FROM tm_receive_serials receive_serial
         INNER JOIN tm_product_trucks product
           ON product.serial_id = receive_serial.serial_id AND product.serial_no = receive_serial.serial_no
         INNER JOIN tm_trucks truck ON truck.id = product.truck_load_id
         WHERE receive_serial.receive_business_id <=> issue.receive_business_id
           AND receive_serial.receive_walkin_id <=> issue.receive_walkin_id
           AND truck.user_truck_id = ?
       )
       GROUP BY issue.delivery_issue_id, issue.receive_code, issue.issue_type, issue.issue_status, issue.receive_business_id, issue.receive_walkin_id
       ORDER BY updated_at DESC, issue.delivery_issue_id DESC`,
      [driverId, driverId, driverId],
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "ไม่สามารถโหลดรายการแชตได้" });
  }
};

export const createDriverDeliveryIssue = async (req, res) => {
  let connection;
  try {
    const driverId = toNumberOrNull(req.user?.id);
    const receiveBusinessId = toNumberOrNull(req.body?.receive_business_id);
    const receiveWalkinId = toNumberOrNull(req.body?.receive_walkin_id);
    const reasonSendProblemId = toNumberOrNull(req.body?.reason_send_problem_id);
    let issueType = cleanText(req.body?.issue_type)?.slice(0, 100) || "แจ้งปัญหาการจัดส่ง";
    const initialMessage = cleanText(req.body?.message_text)?.slice(0, 10000) || null;
    if (!driverId || (receiveBusinessId === null) === (receiveWalkinId === null)) throw inputError("ข้อมูลบิลไม่ถูกต้อง");
    connection = await db.getConnection();
    await connection.beginTransaction();
    if (reasonSendProblemId) {
      const [[reason]] = await connection.query(
        `SELECT reason_send_problem_detail
         FROM mm_reason_send_problems
         WHERE reason_send_problem_id = ? LIMIT 1`,
        [reasonSendProblemId],
      );
      if (!reason?.reason_send_problem_detail) throw inputError("ไม่พบหัวข้อปัญหาที่เลือก");
      issueType = String(reason.reason_send_problem_detail).trim().slice(0, 100);
    }
    const bill = await requireDriverBill(connection, { driverId, receiveBusinessId, receiveWalkinId });
    const [[existing]] = await connection.query("SELECT delivery_issue_id FROM tm_delivery_issues WHERE receive_business_id <=> ? AND receive_walkin_id <=> ? LIMIT 1 FOR UPDATE", [bill.receive_business_id, bill.receive_walkin_id]);
    if (existing) {
      let messageId = null;
      if (initialMessage) {
        const now = new Date();
        const [messageResult] = await connection.query(
          "INSERT INTO tm_delivery_messages (delivery_issue_id, sender_user_id, message_text, created_date) VALUES (?, ?, ?, ?)",
          [existing.delivery_issue_id, driverId, initialMessage, now],
        );
        messageId = messageResult.insertId;
        await connection.query("UPDATE tm_delivery_issues SET updated_by = ?, updated_date = ? WHERE delivery_issue_id = ?", [driverId, now, existing.delivery_issue_id]);
      }
      await connection.commit();
      if (messageId) emitDeliveryIssue(existing.delivery_issue_id, "delivery-issue:message", { issueId: existing.delivery_issue_id });
      if (messageId) emitDeliveryIssueInbox({ issueId: existing.delivery_issue_id });
      if (messageId) void emitDriverDeliveryIssueInbox(existing.delivery_issue_id, { issueId: existing.delivery_issue_id });
      return res.json({ success: true, data: { delivery_issue_id: existing.delivery_issue_id, delivery_status_message_id: messageId, created: false } });
    }
    const now = new Date();
    const [result] = await connection.query(
      `INSERT INTO tm_delivery_issues (receive_business_id, receive_walkin_id, receive_code, issue_type, reason_send_problem_id, issue_status, created_by, created_date, updated_by, updated_date)
       VALUES (?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?)`,
      [bill.receive_business_id, bill.receive_walkin_id, bill.receive_code, issueType, reasonSendProblemId, driverId, now, driverId, now],
    );
    let messageId = null;
    if (initialMessage) {
      const [messageResult] = await connection.query(
        "INSERT INTO tm_delivery_messages (delivery_issue_id, sender_user_id, message_text, created_date) VALUES (?, ?, ?, ?)",
        [result.insertId, driverId, initialMessage, now],
      );
      messageId = messageResult.insertId;
    }
    await connection.commit();
    if (messageId) emitDeliveryIssue(result.insertId, "delivery-issue:message", { issueId: result.insertId });
    emitDeliveryIssueInbox({ issueId: result.insertId });
    void emitDriverDeliveryIssueInbox(result.insertId, { issueId: result.insertId });
    return res.status(201).json({ success: true, data: { delivery_issue_id: result.insertId, delivery_status_message_id: messageId, created: true } });
  } catch (error) {
    await connection?.rollback();
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "ไม่สามารถสร้างเคสแจ้งปัญหาได้" });
  } finally {
    connection?.release();
  }
};

export const getDriverDeliveryIssueMessages = async (req, res) => {
  try {
    const driverId = toNumberOrNull(req.user?.id);
    const issueId = toNumberOrNull(req.params.deliveryIssueId);
    if (!driverId || !Number.isInteger(issueId) || issueId <= 0) throw inputError("ข้อมูลเคสไม่ถูกต้อง");
    const issue = await findDriverIssue(db, driverId, issueId);
    const [messages] = await db.query(
      `SELECT message.delivery_status_message_id, message.sender_user_id, message.message_text, message.created_date,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', sender.first_name, sender.last_name)), ''), sender.username, '-') AS sender_name,
              sender_role.name AS role_name
       FROM tm_delivery_messages message
       LEFT JOIN um_users sender ON sender.id = message.sender_user_id
       LEFT JOIN mm_roles sender_role ON sender_role.id = sender.role_id
       WHERE message.delivery_issue_id = ? ORDER BY message.created_date, message.delivery_status_message_id`,
      [issue.delivery_issue_id],
    );
    const ids = messages.map((message) => message.delivery_status_message_id);
    const [media] = ids.length ? await db.query(
      `SELECT delivery_status_message_id, file_name, file_path, mime_type
       FROM tm_delivery_message_media WHERE delivery_status_message_id IN (${ids.map(() => "?").join(",")}) ORDER BY delivery_status_message_media_id`, ids,
    ) : [[]];
    const mediaByMessage = new Map();
    media.forEach((item) => mediaByMessage.set(item.delivery_status_message_id, [...(mediaByMessage.get(item.delivery_status_message_id) || []), item]));
    if (ids.length) await db.query(
      `INSERT IGNORE INTO tm_delivery_message_reads (delivery_status_message_id, user_id, read_date)
       SELECT delivery_status_message_id, ?, ? FROM tm_delivery_messages WHERE delivery_issue_id = ? AND sender_user_id <> ?`,
      [driverId, new Date(), issue.delivery_issue_id, driverId],
    );
    return res.json({ success: true, data: { thread: issue, messages: messages.map((message) => ({ ...message, media: mediaByMessage.get(message.delivery_status_message_id) || [] })) } });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "ไม่สามารถโหลดข้อความได้" });
  }
};

export const createDriverDeliveryIssueMessage = async (req, res) => {
  let connection;
  const createdFiles = [];
  try {
    const driverId = toNumberOrNull(req.user?.id);
    const issueId = toNumberOrNull(req.params.deliveryIssueId);
    const messageText = cleanText(req.body?.message_text)?.slice(0, 10000) || null;
    const files = uploadedImages(req);
    if (!driverId || !Number.isInteger(issueId) || issueId <= 0 || (!messageText && !files.length)) throw inputError("กรุณาระบุข้อความหรือรูปภาพ");
    connection = await db.getConnection();
    await connection.beginTransaction();
    const issue = await findDriverIssue(connection, driverId, issueId);
    const now = new Date();
    const [result] = await connection.query(
      "INSERT INTO tm_delivery_messages (delivery_issue_id, sender_user_id, message_text, created_date) VALUES (?, ?, ?, ?)",
      [issue.delivery_issue_id, driverId, messageText, now],
    );
    const directory = path.join(uploadsDirectory, "delivery-issues", String(issue.delivery_issue_id), "chat");
    await fs.mkdir(directory, { recursive: true });
    for (const file of files) {
      const filePath = path.join(directory, file.storedName);
      await fs.writeFile(filePath, file.buffer, { flag: "wx" });
      createdFiles.push(filePath);
      await connection.query(
        `INSERT INTO tm_delivery_message_media (delivery_status_message_id, file_name, file_path, mime_type, file_size, created_by, created_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, file.storedName, `/uploads/delivery-issues/${issue.delivery_issue_id}/chat/${file.storedName}`, file.mimetype, file.size, driverId, now],
      );
    }
    await connection.query("UPDATE tm_delivery_issues SET updated_by = ?, updated_date = ? WHERE delivery_issue_id = ?", [driverId, now, issue.delivery_issue_id]);
    await connection.commit();
    const payload = { issueId: issue.delivery_issue_id };
    emitDeliveryIssue(issue.delivery_issue_id, "delivery-issue:message", payload);
    emitDeliveryIssueInbox(payload);
    void emitDriverDeliveryIssueInbox(issue.delivery_issue_id, payload);
    return res.status(201).json({ success: true, data: { delivery_status_message_id: result.insertId } });
  } catch (error) {
    await connection?.rollback();
    await Promise.all(createdFiles.map((file) => fs.unlink(file).catch(() => undefined)));
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "ไม่สามารถส่งข้อความได้" });
  } finally {
    connection?.release();
  }
};
