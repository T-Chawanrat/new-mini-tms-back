import db from "../config/db.js";
import { buildLike } from "../utils/cleanText.js";

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

    // CUSTOMER สร้างได้เฉพาะ customer_id ของตัวเอง
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

    // CUSTOMER แก้ได้เฉพาะ customer_id ของตัวเอง
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
