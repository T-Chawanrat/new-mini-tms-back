import fs from "fs";
import path from "path";
import bwipjs from "bwip-js";
import QRCode from "qrcode";
import db from "../config/db.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LABEL_DIR = path.join(__dirname, "..", "labels");

const sanitize = (text) => {
  return String(text || "").replace(/[^a-zA-Z0-9_-]/g, "_");
};

const generateBarcode = async (serial) => {
  const clean = sanitize(serial);
  const filename = `barcode_${clean}.png`;
  const filepath = path.join(LABEL_DIR, filename);

  if (!fs.existsSync(filepath)) {
    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text: String(serial),
      scale: 3,
      height: 10,
      includetext: false,
    });

    await fs.promises.writeFile(filepath, png);
  }

  return filename;
};

const generateQR = async (serial) => {
  const clean = sanitize(serial);
  const filename = `qr_${clean}.png`;
  const filepath = path.join(LABEL_DIR, filename);

  if (!fs.existsSync(filepath)) {
    await QRCode.toFile(filepath, String(serial), {
      width: 200,
      margin: 1,
    });
  }

  return filename;
};

export const getPrintLabels = async (req, res) => {
  let connection;

  try {
    const userId = req.user?.user_id || req.query.user_id;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุ user_id หรือ login ให้เรียบร้อย",
      });
    }

    await fs.promises.mkdir(LABEL_DIR, { recursive: true });
    connection = await db.getConnection();

    const [[userRow]] = await connection.query(
      `SELECT role_id FROM um_users WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (!userRow) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบผู้ใช้งาน (user_id) ในระบบ",
      });
    }

    const roleId = Number(userRow.role_id);
    const canSeeAll = [1, 5, 7].includes(roleId);
    const onlySelf = roleId === 2;

    if (!canSeeAll && !onlySelf) {
      return res.status(403).json({
        success: false,
        message: "คุณไม่มีสิทธิ์เข้าถึงข้อมูลส่วนนี้",
      });
    }

    let sql = `
      SELECT *
      FROM bills_data
      WHERE customer_input = 'Y'
      AND created_at >= (NOW() - INTERVAL 1 DAY)
    `;
    const params = [];

    if (onlySelf) {
      sql += ` AND user_id = ? `;
      params.push(userId);
    }

    sql += ` ORDER BY id DESC `;

    const [rows] = await connection.query(sql, params);

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const result = await Promise.all(
      rows.map(async (row) => {
        const serialNo = row.SERIAL_NO;

        if (!serialNo) {
          return { ...row, barcode_url: null, qr_url: null };
        }

        const barcodeFile = await generateBarcode(serialNo);
        const qrFile = await generateQR(serialNo);

        return {
          ...row,
          barcode_url: `${baseUrl}/labels/${barcodeFile}`,
          qr_url: `${baseUrl}/labels/${qrFile}`,
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (err) {
    console.error("Error getPrintLabels:", err);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูล/สร้าง Label",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getReprintLabels = async (req, res) => {
  let connection;

  try {
    const userId = req.user?.user_id || req.query.user_id;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุ user_id หรือ login ให้เรียบร้อย",
      });
    }

    await fs.promises.mkdir(LABEL_DIR, { recursive: true });
    connection = await db.getConnection();

    const [[userRow]] = await connection.query(
      `SELECT role_id FROM um_users WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (!userRow) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบผู้ใช้งาน (user_id) ในระบบ",
      });
    }

    const roleId = Number(userRow.role_id);
    const canSeeAll = [1, 5, 7].includes(roleId);
    const onlySelf = roleId === 2;

    if (!canSeeAll && !onlySelf) {
      return res.status(403).json({
        success: false,
        message: "คุณไม่มีสิทธิ์เข้าถึงข้อมูลส่วนนี้",
      });
    }

    const serial = (req.query.serial || "").toString().trim();
    const reference = (req.query.reference || "").toString().trim();
    let date = (req.query.date || "").toString().trim();
    const customerName = (req.query.customer_name || "").toString().trim();
    const warehouseName = (req.query.warehouse_name || "").toString().trim();

    let sql = `
      SELECT *
      FROM bills_data
      WHERE customer_input = 'Y'
    `;
    const params = [];

    if (onlySelf) {
      sql += ` AND user_id = ? `;
      params.push(userId);
    }

    if (serial) {
      sql += ` AND SERIAL_NO LIKE ? `;
      params.push(`%${serial}%`);
    }

    if (reference) {
      sql += ` AND REFERENCE LIKE ? `;
      params.push(`%${reference}%`);
    }

    if (!date) {
      const now = new Date(
        new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" })
      );
      date = now.toISOString().slice(0, 10); // YYYY-MM-DD
    }

    if (customerName) {
      sql += ` AND CUSTOMER_NAME = ? `;
      params.push(customerName);
    }

    if (warehouseName) {
      sql += ` AND warehouse_name = ? `;
      params.push(warehouseName);
    }

    sql += ` ORDER BY id DESC `;

    const [rows] = await connection.query(sql, params);

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const result = await Promise.all(
      rows.map(async (row) => {
        const serialNo = row.SERIAL_NO;

        if (!serialNo) {
          return { ...row, barcode_url: null, qr_url: null };
        }

        const barcodeFile = await generateBarcode(serialNo);
        const qrFile = await generateQR(serialNo);

        return {
          ...row,
          barcode_url: `${baseUrl}/labels/${barcodeFile}`,
          qr_url: `${baseUrl}/labels/${qrFile}`,
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (err) {
    console.error("Error getPrintLabels:", err);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูล/สร้าง Label",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export default {
  getPrintLabels,
  getReprintLabels,
};

