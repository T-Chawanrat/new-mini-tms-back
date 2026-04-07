import db from "../config/db.js";
import fs from "fs";
import path from "path";

export const createBill = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const { user_id, REFERENCE, name, surname, license_plate, remark } =
      req.body;

    const signatureFile = req.files?.signature ? req.files.signature[0] : null;
    const imageFiles = req.files?.images || [];

    const [[userRow]] = await connection.query(
      `SELECT dc_id FROM um_users WHERE user_id = ?`,
      [user_id]
    );

    const dc_id = userRow?.dc_id || null;

    const [[usedRow]] = await connection.query(
      `
  SELECT COUNT(*) AS cnt
  FROM bills_data
  WHERE REFERENCE = ?
    AND image = 'Y'
    AND sign = 'Y'
  `,
      [REFERENCE]
    );

    if (usedRow.cnt > 0) {
      await connection.rollback();
      return res.status(409).json({
        message:
          "REFERENCE นี้มีการอัปโหลดรูปและเซ็นแล้ว ไม่สามารถบันทึกซ้ำได้",
      });
    }

    const [billResult] = await connection.query(
      `INSERT INTO bills (user_id, REFERENCE, name, surname, license_plate, dc_id, sign, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        REFERENCE,
        name,
        surname,
        license_plate,
        dc_id,
        signatureFile ? signatureFile.path : null,
        remark,
      ]
    );

    const billId = billResult.insertId;

    const [[pendingRow]] = await connection.query(
      `
      SELECT COUNT(*) AS cnt
      FROM bills_data
      WHERE REFERENCE = ?
      AND warehouse_accept = 'N'
      AND dc_accept = 'N'
      `,
      [REFERENCE]
    );

    if (imageFiles.length > 0) {
      const imageValues = imageFiles.map((file) => [billId, file.path]);

      if (imageValues.length > 0) {
        await connection.query(
          `INSERT INTO bill_images (bill_id, image_url) VALUES ?`,
          [imageValues]
        );
      }
    }

    await connection.query(
      `
      UPDATE bills_data
      SET image = 'Y',
          sign = 'Y'
      WHERE REFERENCE = ?
      `,
      [REFERENCE]
    );

    await connection.commit();

    return res.status(201).json({
      message: "บันทึกสำเร็จ",
      id: billId,
      imageCount: imageFiles.length,
      hasSignature: !!signatureFile,
      pendingAcceptCount: pendingRow.cnt,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("BACKEND ERROR:", err);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการบันทึก (backend error)",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const updateBillImages = async (req, res) => {
  let connection;

  try {
    const billId = Number(req.params.id);
    if (!billId) {
      return res.status(400).json({ message: "billId ไม่ถูกต้อง" });
    }

    let deleteImageUrls = [];

    if (req.body.deleteImageUrls) {
      try {
        deleteImageUrls = JSON.parse(req.body.deleteImageUrls);
      } catch (err) {
        deleteImageUrls = String(req.body.deleteImageUrls)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }

    const imageFiles = req.files?.images || [];

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [oldImages] = await connection.query(
      `SELECT id, image_url FROM bill_images WHERE bill_id = ?`,
      [billId]
    );

    if (deleteImageUrls.length > 0) {
      await connection.query(
        `DELETE FROM bill_images WHERE bill_id = ? AND image_url IN (?)`,
        [billId, deleteImageUrls]
      );

      const imagesToDelete = oldImages.filter((img) =>
        deleteImageUrls.includes(img.image_url)
      );

      for (const img of imagesToDelete) {
        const filePath = path.resolve(img.image_url);

        try {
          await fs.promises.unlink(filePath);
        } catch (err) {
          console.warn("⚠ ลบไฟล์ไม่ได้ หรือไม่มีไฟล์:", filePath);
        }
      }
    }

    if (imageFiles.length > 0) {
      const insertValues = imageFiles.map((f) => [billId, f.path]);

      await connection.query(
        `INSERT INTO bill_images (bill_id, image_url) VALUES ?`,
        [insertValues]
      );
    }

    await connection.commit();

    const [updatedImages] = await connection.query(
      `SELECT id, image_url FROM bill_images WHERE bill_id = ?`,
      [billId]
    );

    return res.status(200).json({
      message: "อัปเดตรูปของบิลเรียบร้อย",
      billId,
      deleted: deleteImageUrls,
      addedCount: imageFiles.length,
      images: updatedImages,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("UPDATE BILL IMAGES ERROR:", err);

    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการอัปเดตรูปของบิล",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

const DOMAIN = "https://xsendwork.com";

export const getBill = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const billId = req.params.id;

    const [billRows] = await connection.query(
      `SELECT * FROM bills WHERE id = ?`,
      [billId]
    );

    if (billRows.length === 0) {
      return res.status(404).json({ message: "ไม่พบบิลนี้" });
    }

    const bill = billRows[0];

    const [imageRows] = await connection.query(
      `SELECT image_url FROM bill_images WHERE bill_id = ?`,
      [billId]
    );

    bill.images = imageRows.map((img) =>
      img.image_url ? `${DOMAIN}/${img.image_url}` : null
    );

    if (bill.sign) {
      bill.sign = `${DOMAIN}/${bill.sign}`;
    }

    res.status(200).json({
      bill,
    });
  } catch (err) {
    console.error("Error getting bill:", err);
    res.status(500).json({
      message: "เกิดข้อผิดพลาดในการดึงข้อมูล",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getBills = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const [bills] = await connection.query(
      `SELECT * FROM bills ORDER BY id DESC`
    );

    for (let bill of bills) {
      const [images] = await connection.query(
        `SELECT image_url FROM bill_images WHERE bill_id = ?`,
        [bill.id]
      );

      bill.images = images.map((img) =>
        img.image_url ? `${DOMAIN}/${img.image_url}` : null
      );

      if (bill.sign) {
        bill.sign = `${DOMAIN}/${bill.sign}`;
      }
    }

    res.status(200).json({ bills });
  } catch (err) {
    console.error("Error getting bills:", err);
    res.status(500).json({
      message: "เกิดข้อผิดพลาดในการดึงข้อมูล",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const downloadImage = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const billId = req.params.id;

    const [billRows] = await connection.query(
      `SELECT sign FROM bills WHERE id = ?`,
      [billId]
    );

    if (billRows.length === 0) {
      return res.status(404).json({ message: "ไม่พบบิลนี้" });
    }

    const bill = billRows[0];

    const [imageRows] = await connection.query(
      `SELECT image_url FROM bill_images WHERE bill_id = ?`,
      [billId]
    );

    const DOMAIN = "https://xsendwork.com";
    const fileUrls = [];

    if (bill.sign) {
      fileUrls.push(`${DOMAIN}/${bill.sign}`);
    }

    for (const img of imageRows) {
      if (img.image_url) {
        fileUrls.push(`${DOMAIN}/${img.image_url}`);
      }
    }

    res.status(200).json({ files: fileUrls });
  } catch (err) {
    console.error("Error in downloadImage:", err);
    res.status(500).json({
      message: "เกิดข้อผิดพลาดในการดึงไฟล์",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

export const getBillsBySerial = async (req, res) => {
  let connection;

  try {
    connection = await db.getConnection();
    let { SERIAL_NO } = req.query;

    if (!SERIAL_NO || !SERIAL_NO.trim()) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุ SERIAL_NO",
      });
    }

    SERIAL_NO = SERIAL_NO.trim();

    if (SERIAL_NO.length < 6) {
      return res.status(400).json({
        success: false,
        message: "SERIAL_NO ไม่ถูกต้อง",
      });
    }

    const [rows] = await connection.query(
      `SELECT * FROM bills_data WHERE SERIAL_NO = ?`,
      [SERIAL_NO]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลสำหรับ SERIAL_NO นี้",
      });
    }

    if (rows.length > 1) {
      return res.status(409).json({
        success: false,
        message: "พบ SERIAL_NO นี้ซ้ำในระบบ",
      });
    }

    const reference = rows[0].REFERENCE;

    const [serialRows] = await connection.query(
      `
      SELECT SERIAL_NO
      FROM bills_data
      WHERE REFERENCE = ?
      ORDER BY SERIAL_NO ASC
      `,
      [reference]
    );

    const serials = serialRows.map((r) => r.SERIAL_NO);
    const uniqueSerials = Array.from(new Set(serials));

    res.status(200).json({
      success: true,
      data: {
        bill: rows[0],
        REFERENCE: reference,
        SERIALS: uniqueSerials,
        serialCount: uniqueSerials.length,
      },
    });
  } catch (err) {
    console.error("Error getBillsBySerial:", err);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดภายในระบบ",
    });
  } finally {
    if (connection) connection.release();
  }
};
