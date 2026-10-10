import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import db from "../../config/db.js";
import { getUploadUrl } from "../../utils/file-url.js";
import { formatDateTime } from "../../utils/format-date.js";
import { cleanFileNamePart, cleanText, toNumberOrNull } from "../../utils/input.js";
import { buildInsertSql, buildLike } from "../../utils/sql.js";

const uploadsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../uploads");
const maxImages = 4;

const actorIdOf = (req) => toNumberOrNull(req.user?.id ?? req.user?.user_id);
const uploadedImages = (req) => (Array.isArray(req.files) ? req.files : []);

const announcementInput = (body) => {
  const title = cleanText(body.title)?.slice(0, 255) || "";
  const content = cleanText(body.content) || "";

  if (!title || !content) return null;
  return { title, content };
};

const getMediaByAnnouncementIds = async (connection, announcementIds) => {
  if (!announcementIds.length) return new Map();
  const placeholders = announcementIds.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `SELECT announcement_media_id, announcement_id, file_name, file_path, mime_type, file_size, display_order
     FROM tm_announcement_media
     WHERE announcement_id IN (${placeholders}) AND is_deleted = 0
     ORDER BY announcement_id, display_order, announcement_media_id`,
    announcementIds,
  );
  return rows.reduce((mediaByAnnouncement, row) => {
    const media = mediaByAnnouncement.get(row.announcement_id) || [];
    media.push({
      id: row.announcement_media_id,
      name: row.file_name,
      preview: row.file_path,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      displayOrder: row.display_order,
    });
    mediaByAnnouncement.set(row.announcement_id, media);
    return mediaByAnnouncement;
  }, new Map());
};

const serializeAnnouncements = async (connection, announcements) => {
  const mediaByAnnouncement = await getMediaByAnnouncementIds(connection, announcements.map((item) => item.id));
  return announcements.map((announcement) => {
    const media = mediaByAnnouncement.get(announcement.id) || [];
    return {
      ...announcement,
      createdDate: formatDateTime(announcement.createdDate),
      isPinned: Boolean(announcement.isPinned),
      media,
      imageUrls: media.map((item) => item.preview),
    };
  });
};

const activeMediaCount = async (connection, announcementId) => {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) AS total FROM tm_announcement_media WHERE announcement_id = ? AND is_deleted = 0`,
    [announcementId],
  );
  return Number(row.total);
};

const saveFiles = async (connection, announcementId, files, actorId, now, createdFiles) => {
  if (!files.length) return;
  const relativeDirectory = path.posix.join("announcements", String(announcementId));
  const absoluteDirectory = path.join(uploadsDirectory, ...relativeDirectory.split("/"));
  await fs.mkdir(absoluteDirectory, { recursive: true });
  const mediaCount = await activeMediaCount(connection, announcementId);

  for (const [index, file] of files.entries()) {
    const storedName = file.storedName;
    const originalName = cleanFileNamePart(path.parse(file.originalname || "").name);
    const absolutePath = path.join(absoluteDirectory, storedName);
    await fs.writeFile(absolutePath, file.buffer);
    createdFiles.push(absolutePath);
    const insertMedia = buildInsertSql("tm_announcement_media", {
      announcement_id: announcementId,
      file_name: originalName ? `${originalName}${path.extname(storedName)}`.slice(0, 255) : storedName,
      file_path: getUploadUrl(relativeDirectory, storedName),
      mime_type: file.mimetype,
      file_size: file.size,
      display_order: mediaCount + index + 1,
      is_deleted: 0,
      created_by: actorId,
      created_date: now,
    });
    await connection.query(insertMedia.sql, insertMedia.values);
  }
};

export const getAnnouncements = async (req, res) => {
  try {
    const search = cleanText(req.query.search)?.slice(0, 200) || "";
    const searchSql = search ? `AND (${buildLike("announcement.title", search)} OR ${buildLike("announcement.content", search)})` : "";
    const [rows] = await db.query(
      `SELECT announcement.announcement_id AS id, announcement.title, announcement.content,
              announcement.is_pinned AS isPinned, announcement.created_date AS createdDate,
              creator.first_name AS createdFirstName, creator.last_name AS createdLastName
       FROM tm_announcements announcement
       LEFT JOIN um_users creator ON creator.id = announcement.created_by
       WHERE announcement.is_deleted = 0 ${searchSql}
       ORDER BY announcement.is_pinned DESC, announcement.created_date DESC, announcement.announcement_id DESC`,
    );
    return res.json({ success: true, data: await serializeAnnouncements(db, rows) });
  } catch (error) {
    console.error("getAnnouncements error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดประกาศได้" });
  }
};

export const getAnnouncementById = async (req, res) => {
  try {
    const announcementId = toNumberOrNull(req.params.announcementId);
    if (!announcementId) return res.status(400).json({ success: false, message: "รหัสประกาศไม่ถูกต้อง" });
    const [rows] = await db.query(
      `SELECT announcement.announcement_id AS id, announcement.title, announcement.content,
              announcement.is_pinned AS isPinned, announcement.created_date AS createdDate
       FROM tm_announcements announcement
       WHERE announcement.announcement_id = ? AND announcement.is_deleted = 0`,
      [announcementId],
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "ไม่พบประกาศ" });
    const [announcement] = await serializeAnnouncements(db, rows);
    return res.json({ success: true, data: announcement });
  } catch (error) {
    console.error("getAnnouncementById error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดประกาศได้" });
  }
};

export const createAnnouncement = async (req, res) => {
  let connection;
  const createdFiles = [];
  try {
    const actorId = actorIdOf(req);
    const input = announcementInput(req.body);
    const files = uploadedImages(req);
    const now = new Date();
    if (!actorId || !input) return res.status(400).json({ success: false, message: "กรุณากรอกหัวข้อและรายละเอียดประกาศให้ครบ" });
    if (files.length > maxImages) return res.status(400).json({ success: false, message: "อัปโหลดรูปได้ไม่เกิน 4 รูป" });

    connection = await db.getConnection();
    await connection.beginTransaction();
    const insertAnnouncement = buildInsertSql("tm_announcements", {
      title: input.title,
      content: input.content,
      is_pinned: 0,
      is_deleted: 0,
      created_by: actorId,
      created_date: now,
    });
    const [result] = await connection.query(insertAnnouncement.sql, insertAnnouncement.values);
    await saveFiles(connection, result.insertId, files, actorId, now, createdFiles);
    await connection.commit();

    const [rows] = await connection.query(
      `SELECT announcement_id AS id, title, content, is_pinned AS isPinned, created_date AS createdDate
       FROM tm_announcements WHERE announcement_id = ?`,
      [result.insertId],
    );
    const [announcement] = await serializeAnnouncements(connection, rows);
    return res.status(201).json({ success: true, data: announcement });
  } catch (error) {
    await connection?.rollback();
    await Promise.all(createdFiles.map((filePath) => fs.unlink(filePath).catch(() => undefined)));
    console.error("createAnnouncement error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถสร้างประกาศได้" });
  } finally {
    connection?.release();
  }
};

export const updateAnnouncement = async (req, res) => {
  let connection;
  const createdFiles = [];
  try {
    const actorId = actorIdOf(req);
    const announcementId = toNumberOrNull(req.params.announcementId);
    const input = announcementInput(req.body);
    const files = uploadedImages(req);
    const now = new Date();
    if (!actorId || !announcementId || !input) return res.status(400).json({ success: false, message: "ข้อมูลประกาศไม่ถูกต้อง" });

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [[announcement]] = await connection.query(
      `SELECT announcement_id FROM tm_announcements WHERE announcement_id = ? AND is_deleted = 0 FOR UPDATE`,
      [announcementId],
    );
    if (!announcement) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "ไม่พบประกาศ" });
    }

    const currentMediaCount = await activeMediaCount(connection, announcementId);
    if (currentMediaCount + files.length > maxImages) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "ประกาศหนึ่งรายการมีรูปได้ไม่เกิน 4 รูป" });
    }

    await connection.query(
      `UPDATE tm_announcements
       SET title = ?, content = ?, updated_by = ?, updated_date = ?
       WHERE announcement_id = ?`,
      [input.title, input.content, actorId, now, announcementId],
    );
    await saveFiles(connection, announcementId, files, actorId, now, createdFiles);
    await connection.commit();

    const [rows] = await connection.query(
      `SELECT announcement_id AS id, title, content, is_pinned AS isPinned, created_date AS createdDate
       FROM tm_announcements WHERE announcement_id = ?`,
      [announcementId],
    );
    const [updatedAnnouncement] = await serializeAnnouncements(connection, rows);
    return res.json({ success: true, data: updatedAnnouncement });
  } catch (error) {
    await connection?.rollback();
    await Promise.all(createdFiles.map((filePath) => fs.unlink(filePath).catch(() => undefined)));
    console.error("updateAnnouncement error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถแก้ไขประกาศได้" });
  } finally {
    connection?.release();
  }
};

export const toggleAnnouncementPinned = async (req, res) => {
  try {
    const actorId = actorIdOf(req);
    const announcementId = toNumberOrNull(req.params.announcementId);
    const now = new Date();
    if (!actorId || !announcementId) return res.status(400).json({ success: false, message: "ข้อมูลประกาศไม่ถูกต้อง" });
    const [result] = await db.query(
      `UPDATE tm_announcements
       SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END,
           updated_by = ?, updated_date = ?
       WHERE announcement_id = ? AND is_deleted = 0`,
      [actorId, now, announcementId],
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "ไม่พบประกาศ" });
    return res.json({ success: true, message: "อัปเดตการปักหมุดแล้ว" });
  } catch (error) {
    console.error("toggleAnnouncementPinned error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถอัปเดตการปักหมุดได้" });
  }
};

export const deleteAnnouncement = async (req, res) => {
  try {
    const actorId = actorIdOf(req);
    const announcementId = toNumberOrNull(req.params.announcementId);
    const now = new Date();
    if (!actorId || !announcementId) return res.status(400).json({ success: false, message: "ข้อมูลประกาศไม่ถูกต้อง" });
    const [result] = await db.query(
      `UPDATE tm_announcements
       SET is_deleted = 1, deleted_by = ?, deleted_date = ?
       WHERE announcement_id = ? AND is_deleted = 0`,
      [actorId, now, announcementId],
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "ไม่พบประกาศ" });
    return res.json({ success: true, message: "ลบประกาศแล้ว" });
  } catch (error) {
    console.error("deleteAnnouncement error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถลบประกาศได้" });
  }
};

export const deleteAnnouncementMedia = async (req, res) => {
  try {
    const actorId = actorIdOf(req);
    const announcementId = toNumberOrNull(req.params.announcementId);
    const mediaId = toNumberOrNull(req.params.mediaId);
    const now = new Date();
    if (!actorId || !announcementId || !mediaId) return res.status(400).json({ success: false, message: "ข้อมูลรูปไม่ถูกต้อง" });
    const [result] = await db.query(
      `UPDATE tm_announcement_media
       SET is_deleted = 1, deleted_by = ?, deleted_date = ?
       WHERE announcement_media_id = ? AND announcement_id = ? AND is_deleted = 0`,
      [actorId, now, mediaId, announcementId],
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "ไม่พบรูปประกาศ" });
    return res.json({ success: true, message: "ลบรูปประกาศแล้ว" });
  } catch (error) {
    console.error("deleteAnnouncementMedia error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถลบรูปประกาศได้" });
  }
};
