import db from "../config/db.js";
import fs from "fs/promises";
import path from "path";
import { buildLike } from "../utils/cleanText.js";
import { getShipperROImageUrl } from "../utils/fileUrl.js";
import { cleanFileNamePart } from "../utils/cleanText.js";

/* ================= SHIPPERS ================= */

export const getShippers = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const customerIdParam = req.params.customer_id;
    const { customer_id, search } = req.query;

    let sql = `
      SELECT
        s.shipper_id,
        s.shipper_code,
        s.shipper_type_id,
        st.name AS shipper_type_name,
        s.shipper_name,
        s.address,

        s.subdistrict_id,
        s.district_id,
        s.province_id,
        s.zip_code,

        a.subdistrict_name,
        a.district_name,
        a.province_name,

        s.tel,
        s.fax,
        s.customer_id,
        c.code AS customer_code,
        c.name AS customer_name,
        s.is_deleted

      FROM mm_shippers s

      LEFT JOIN mm_shipper_types st
        ON st.id = s.shipper_type_id

      LEFT JOIN mm_customers c 
        ON c.id = s.customer_id

      LEFT JOIN mm_master_addresses a
        ON a.subdistrict_id = s.subdistrict_id
        AND a.district_id = s.district_id
        AND a.province_id = s.province_id

      WHERE 1=1
    `;

    const params = [];

    if (Number(req.user.role_id) === 2) {
      sql += ` AND s.customer_id = ?`;
      params.push(req.user.customer_id);
    } else if (customerIdParam) {
      sql += ` AND s.customer_id = ?`;
      params.push(customerIdParam);
    } else if (customer_id) {
      sql += ` AND s.customer_id = ?`;
      params.push(customer_id);
    }

    if (search) {
      sql += `
        AND (
          ${buildLike("s.shipper_code", search)}
          OR ${buildLike("s.shipper_name", search)}
          OR ${buildLike("s.tel", search)}
          OR ${buildLike("s.zip_code", search)}
          OR ${buildLike("a.subdistrict_name", search)}
          OR ${buildLike("a.district_name", search)}
          OR ${buildLike("a.province_name", search)}
          OR ${buildLike("c.code", search)}
          OR ${buildLike("c.name", search)}
          OR ${buildLike("st.name", search)}
        )
      `;
    }

    sql += ` ORDER BY s.shipper_id DESC`;

    const [rows] = await db.query(sql, params);

    res.json(rows);
  } catch (err) {
    console.error("GET SHIPPERS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const createShipper = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id } = req.params;

    const { shipper_code, shipper_type_id, shipper_name, address, subdistrict_id, district_id, province_id, zip_code, tel, fax } = req.body;

    if (!customer_id) {
      return res.status(400).json({ message: "customer_id required" });
    }

    if (!shipper_code || !shipper_name) {
      return res.status(400).json({
        message: "shipper_code / shipper_name required",
      });
    }

    const [customerRows] = await db.query(
      `
      SELECT id
      FROM mm_customers
      WHERE id = ?
        AND is_active = '1'
      LIMIT 1
      `,
      [customer_id],
    );

    if (customerRows.length === 0) {
      return res.status(400).json({
        message: "customer not found or inactive",
      });
    }

    const [exists] = await db.query(
      `
      SELECT shipper_id
      FROM mm_shippers
      WHERE customer_id = ?
        AND shipper_code = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [customer_id, shipper_code],
    );

    if (exists.length > 0) {
      return res.status(400).json({
        message: "shipper_code นี้มีใน customer นี้แล้ว",
      });
    }

    const [result] = await db.query(
      `
      INSERT INTO mm_shippers (
        shipper_code,
        shipper_type_id,
        shipper_name,
        address,
        subdistrict_id,
        district_id,
        province_id,
        zip_code,
        tel,
        fax,
        customer_id,
        is_deleted
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N')
      `,
      [
        shipper_code,
        shipper_type_id || null,
        shipper_name,
        address || null,
        subdistrict_id || null,
        district_id || null,
        province_id || null,
        zip_code || null,
        tel || null,
        fax || null,
        customer_id,
      ],
    );

    res.json({
      message: "create shipper success",
      id: result.insertId,
    });
  } catch (err) {
    console.error("CREATE SHIPPER ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const updateShipper = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id, id } = req.params;

    const {
      shipper_code,
      shipper_type_id,
      shipper_name,
      address,
      subdistrict_id,
      district_id,
      province_id,
      zip_code,
      tel,
      fax,
      longitude,
      latitude,
      priority,
    } = req.body;

    if (!customer_id || !id) {
      return res.status(400).json({ message: "customer_id / id required" });
    }

    if (!shipper_code || !shipper_name) {
      return res.status(400).json({
        message: "shipper_code / shipper_name required",
      });
    }

    const [exists] = await db.query(
      `
      SELECT shipper_id
      FROM mm_shippers
      WHERE customer_id = ?
        AND shipper_code = ?
        AND shipper_id <> ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [customer_id, shipper_code, id],
    );

    if (exists.length > 0) {
      return res.status(400).json({
        message: "shipper_code นี้มีใน customer นี้แล้ว",
      });
    }

    const [result] = await db.query(
      `
      UPDATE mm_shippers SET
        shipper_code = ?,
        shipper_type_id = ?,
        shipper_name = ?,
        address = ?,
        subdistrict_id = ?,
        district_id = ?,
        province_id = ?,
        zip_code = ?,
        tel = ?,
        fax = ?,
        longitude = ?,
        latitude = ?,
        priority = ?
      WHERE shipper_id = ?
        AND customer_id = ?
        AND is_deleted = 'N'
      `,
      [
        shipper_code,
        shipper_type_id || null,
        shipper_name,
        address || null,
        subdistrict_id || null,
        district_id || null,
        province_id || null,
        zip_code || null,
        tel || null,
        fax || null,
        longitude || null,
        latitude || null,
        priority || 0,
        id,
        customer_id,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "shipper not found" });
    }

    res.json({ message: "update shipper success" });
  } catch (err) {
    console.error("UPDATE SHIPPER ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const updateShipperStatus = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customerId, shipperId } = req.params;
    const { is_deleted } = req.body;

    if (!["N", "Y"].includes(is_deleted)) {
      return res.status(400).json({ message: "invalid status" });
    }

    await db.query(
      `
      UPDATE mm_shippers
      SET is_deleted = ?
      WHERE shipper_id = ?
        AND customer_id = ?
      `,
      [is_deleted, shipperId, customerId],
    );

    res.json({ message: "update status success" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const createShipperROCode = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id, shipper_id } = req.params;
    const { ro_code, ro_name } = req.body;

    if (!customer_id || !shipper_id) {
      return res.status(400).json({
        message: "customer_id / shipper_id required",
      });
    }

    if (!ro_code || !ro_code.trim()) {
      return res.status(400).json({
        message: "ro_code required",
      });
    }

    if (!ro_name || !ro_name.trim()) {
      return res.status(400).json({
        message: "ro_name required",
      });
    }

    const cleanROCode = ro_code.trim();
    const cleanROName = ro_name.trim();

    const [shipperRows] = await db.query(
      `
      SELECT shipper_id
      FROM mm_shippers
      WHERE shipper_id = ?
        AND customer_id = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [shipper_id, customer_id],
    );

    if (shipperRows.length === 0) {
      return res.status(404).json({
        message: "shipper not found",
      });
    }

    const [result] = await db.query(
      `
      INSERT INTO mm_shipper_ro_code (
        shipper_id,
        ro_code,
        ro_name,
        is_deleted
      )
      VALUES (?, ?, ?, 'N')
      `,
      [shipper_id, cleanROCode, cleanROName],
    );

    res.json({
      message: "create shipper ro code success",
      ro_code_id: result.insertId,
    });
  } catch (err) {
    console.error("CREATE SHIPPER RO CODE ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const updateShipperROCode = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id, shipper_id, ro_code_id } = req.params;
    const { ro_code, ro_name } = req.body;

    if (!customer_id || !shipper_id || !ro_code_id) {
      return res.status(400).json({
        message: "customer_id / shipper_id / ro_code_id required",
      });
    }

    if (!ro_code || !ro_code.trim()) {
      return res.status(400).json({
        message: "ro_code required",
      });
    }

    if (!ro_name || !ro_name.trim()) {
      return res.status(400).json({
        message: "ro_name required",
      });
    }

    const cleanROCode = ro_code.trim();
    const cleanROName = ro_name.trim();

    const [shipperRows] = await db.query(
      `
      SELECT shipper_id
      FROM mm_shippers
      WHERE shipper_id = ?
        AND customer_id = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [shipper_id, customer_id],
    );

    if (shipperRows.length === 0) {
      return res.status(404).json({
        message: "shipper not found",
      });
    }

    const [roRows] = await db.query(
      `
      SELECT ro_code_id
      FROM mm_shipper_ro_code
      WHERE ro_code_id = ?
        AND shipper_id = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [ro_code_id, shipper_id],
    );

    if (roRows.length === 0) {
      return res.status(404).json({
        message: "ro code not found",
      });
    }

    const [exists] = await db.query(
      `
      SELECT ro_code_id
      FROM mm_shipper_ro_code
      WHERE shipper_id = ?
        AND ro_code = ?
        AND ro_code_id <> ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [shipper_id, cleanROCode, ro_code_id],
    );

    if (exists.length > 0) {
      return res.status(400).json({
        message: "ro_code นี้มีใน shipper นี้แล้ว",
      });
    }

    await db.query(
      `
      UPDATE mm_shipper_ro_code
      SET
        ro_code = ?,
        ro_name = ?,
        updated_at = NOW()
      WHERE ro_code_id = ?
        AND shipper_id = ?
        AND is_deleted = 'N'
      `,
      [cleanROCode, cleanROName, ro_code_id, shipper_id],
    );

    res.json({
      message: "update shipper ro code success",
    });
  } catch (err) {
    console.error("UPDATE SHIPPER RO CODE ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const deleteShipperROCode = async (req, res) => {
  let conn;

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id, shipper_id, ro_code_id } = req.params;

    if (!customer_id || !shipper_id || !ro_code_id) {
      return res.status(400).json({
        message: "customer_id / shipper_id / ro_code_id required",
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    const [shipperRows] = await conn.query(
      `
      SELECT shipper_id
      FROM mm_shippers
      WHERE shipper_id = ?
        AND customer_id = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [shipper_id, customer_id],
    );

    if (shipperRows.length === 0) {
      await conn.rollback();

      return res.status(404).json({
        message: "shipper not found",
      });
    }

    const [roRows] = await conn.query(
      `
      SELECT ro_code_id
      FROM mm_shipper_ro_code
      WHERE ro_code_id = ?
        AND shipper_id = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [ro_code_id, shipper_id],
    );

    if (roRows.length === 0) {
      await conn.rollback();

      return res.status(404).json({
        message: "ro code not found",
      });
    }

    await conn.query(
      `
      UPDATE mm_shipper_ro_code
      SET
        is_deleted = 'Y',
        updated_at = NOW()
      WHERE ro_code_id = ?
        AND shipper_id = ?
        AND is_deleted = 'N'
      `,
      [ro_code_id, shipper_id],
    );

    await conn.query(
      `
      UPDATE mm_shipper_ro_image
      SET
        is_deleted = 'Y',
        updated_at = NOW()
      WHERE ro_code_id = ?
        AND is_deleted = 'N'
      `,
      [ro_code_id],
    );

    await conn.commit();

    res.json({
      message: "delete shipper ro code success",
    });
  } catch (err) {
    if (conn) {
      await conn.rollback();
    }

    console.error("DELETE SHIPPER RO CODE ERROR:", err);
    res.status(500).json({ message: err.message });
  } finally {
    if (conn) {
      conn.release();
    }
  }
};

export const uploadShipperROImages = async (req, res) => {
  let conn;
  let transactionStarted = false;

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id, shipper_id, ro_code_id } = req.params;

    if (!customer_id || !shipper_id || !ro_code_id) {
      return res.status(400).json({
        message: "customer_id / shipper_id / ro_code_id required",
      });
    }

    if (Number(req.user.role_id) === 2) {
      if (!req.user.customer_id) {
        return res.status(403).json({
          message: "customer user has no customer_id",
        });
      }

      if (String(customer_id) !== String(req.user.customer_id)) {
        return res.status(403).json({ message: "forbidden" });
      }
    }

    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({
        message: "images required",
      });
    }

    if (files.length > 5) {
      return res.status(400).json({
        message: "upload images maximum 5 files",
      });
    }

    const allowedExt = [".jpg", ".jpeg", ".png", ".webp"];

    for (const file of files) {
      const ext = path.extname(file.originalname || "").toLowerCase();

      if (!allowedExt.includes(ext)) {
        return res.status(400).json({
          message: "only JPG, PNG, WEBP allowed",
        });
      }
    }

    conn = await db.getConnection();

    const [roRows] = await conn.query(
      `
      SELECT
        ro.ro_code_id,
        ro.ro_code,
        s.shipper_code
      FROM mm_shipper_ro_code ro

      INNER JOIN mm_shippers s
        ON s.shipper_id = ro.shipper_id
        AND s.customer_id = ?
        AND s.is_deleted = 'N'

      WHERE ro.ro_code_id = ?
        AND ro.shipper_id = ?
        AND ro.is_deleted = 'N'

      LIMIT 1
      `,
      [customer_id, ro_code_id, shipper_id],
    );

    if (roRows.length === 0) {
      return res.status(404).json({
        message: "ro_code not found",
      });
    }

    const roData = roRows[0];

    const safeShipperCode = cleanFileNamePart(roData.shipper_code);
    const safeROCode = cleanFileNamePart(roData.ro_code);

    const fileNamePrefix = [safeShipperCode, safeROCode].filter(Boolean).join("_") || "RO";

    await conn.beginTransaction();
    transactionStarted = true;

    const [orderRows] = await conn.query(
      `
      SELECT COALESCE(MAX(image_order), 0) AS max_order
      FROM mm_shipper_ro_image
      WHERE ro_code_id = ?
        AND is_deleted = 'N'
      `,
      [ro_code_id],
    );

    let imageOrder = Number(orderRows[0].max_order || 0);

    const values = [];

    for (const file of files) {
      imageOrder += 1;

      const ext = path.extname(file.originalname || "").toLowerCase();
      const runningNo = String(imageOrder).padStart(4, "0");

      const newFilename = `${fileNamePrefix}_${runningNo}${ext}`;

      const oldPath = file.path;
      const newPath = path.join("uploads", "ro", newFilename);

      await fs.rename(oldPath, newPath);

      values.push([ro_code_id, getShipperROImageUrl(newFilename), imageOrder, "N"]);
    }

    const [result] = await conn.query(
      `
      INSERT INTO mm_shipper_ro_image (
        ro_code_id,
        image_url,
        image_order,
        is_deleted
      )
      VALUES ?
      `,
      [values],
    );

    await conn.commit();
    transactionStarted = false;

    return res.json({
      message: "upload shipper ro images success",
      inserted: result.affectedRows,
      images: values.map((item) => ({
        ro_code_id: item[0],
        image_url: item[1],
        image_order: item[2],
      })),
    });
  } catch (err) {
    if (conn && transactionStarted) {
      await conn.rollback();
    }

    console.error("UPLOAD SHIPPER RO IMAGES ERROR:", err);

    return res.status(500).json({
      message: err.message || "upload shipper ro images failed",
    });
  } finally {
    if (conn) {
      conn.release();
    }
  }
};

export const getShipperROCodes = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id, shipper_id } = req.params;

    if (!customer_id || !shipper_id) {
      return res.status(400).json({
        message: "customer_id / shipper_id required",
      });
    }

    const [shipperRows] = await db.query(
      `
      SELECT shipper_id
      FROM mm_shippers
      WHERE shipper_id = ?
        AND customer_id = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [shipper_id, customer_id],
    );

    if (shipperRows.length === 0) {
      return res.status(404).json({
        message: "shipper not found",
      });
    }

    const [rows] = await db.query(
      `
  SELECT
    ro.ro_code_id,
    ro.shipper_id,
    ro.ro_code,
    ro.ro_name,
    ro.is_deleted,

    img.ro_image_id,
    img.image_url,
    img.image_order,
    img.is_deleted AS image_is_deleted

  FROM mm_shipper_ro_code ro

  LEFT JOIN mm_shipper_ro_image img
    ON img.ro_code_id = ro.ro_code_id
    AND img.is_deleted = 'N'

  WHERE ro.shipper_id = ?
    AND ro.is_deleted = 'N'

  ORDER BY ro.ro_code_id DESC, img.image_order ASC
  `,
      [shipper_id],
    );

    const map = new Map();

    for (const row of rows) {
      if (!map.has(row.ro_code_id)) {
        map.set(row.ro_code_id, {
          ro_code_id: row.ro_code_id,
          shipper_id: row.shipper_id,
          ro_code: row.ro_code,
          ro_name: row.ro_name,
          is_deleted: row.is_deleted,
          images: [],
        });
      }

      if (row.ro_image_id) {
        map.get(row.ro_code_id).images.push({
          ro_image_id: row.ro_image_id,
          image_url: row.image_url,
          image_order: row.image_order,
        });
      }
    }

    res.json([...map.values()]);
  } catch (err) {
    console.error("GET SHIPPER RO CODES ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};
