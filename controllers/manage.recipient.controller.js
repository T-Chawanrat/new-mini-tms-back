import db from "../config/db.js";
import { buildLike } from "../utils/cleanText.js";
import { getPaginationParams } from "../utils/pagination.js";

/* ================= RECIPIENTS ================= */

export const getRecipients = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id } = req.params;
    const { search } = req.query;
    const { page, pageSize, skip } = getPaginationParams(req, 100, 200);

    const isCustomer = Number(req.user.role_id) === 2;

    if (isCustomer && !req.user.customer_id) {
      return res.status(403).json({
        message: "customer user has no customer_id",
      });
    }

    if (!isCustomer && !customer_id) {
      return res.json({
        data: [],
        pagination: {
          page,
          pageSize,
          total: 0,
          totalPages: 0,
        },
      });
    }

    let whereSql = `
      WHERE 1 = 1
        AND r.is_deleted = 'N'
    `;

    const params = [];

    if (isCustomer) {
      whereSql += ` AND r.customer_id = ? `;
      params.push(req.user.customer_id);
    }

    if (!isCustomer && customer_id) {
      whereSql += ` AND r.customer_id = ? `;
      params.push(customer_id);
    }

    if (search) {
      whereSql += `
        AND (
          ${buildLike("r.recipient_code", search)}
          OR ${buildLike("r.recipient_name", search)}
          OR ${buildLike("rt.name", search)}
          OR ${buildLike("rd.recipient_detail_name", search)}
          OR ${buildLike("rd.address", search)}
          OR ${buildLike("rd.tel1", search)}
          OR ${buildLike("rd.tel2", search)}
          OR ${buildLike("rd.zip_code", search)}
          OR ${buildLike("rd.line_id", search)}
          OR ${buildLike("a.subdistrict_name", search)}
          OR ${buildLike("a.district_name", search)}
          OR ${buildLike("a.province_name", search)}
          OR ${buildLike("c.code", search)}
          OR ${buildLike("c.name", search)}
        )
      `;
    }

    const fromSql = `
      FROM mm_recipients r

      JOIN mm_customers c
        ON c.id = r.customer_id
        AND c.is_active = '1'

      LEFT JOIN mm_recipient_types rt
        ON rt.id = r.recipient_type_id
        AND rt.is_deleted = 'N'

      LEFT JOIN mm_recipient_details rd
        ON rd.recipient_id = r.recipient_id

      LEFT JOIN mm_master_addresses a
        ON a.subdistrict_id = rd.subdistrict_id
        AND a.district_id = rd.district_id
        AND a.province_id = rd.province_id
    `;

    const countSql = `
      SELECT COUNT(*) AS total
      ${fromSql}
      ${whereSql}
    `;

    const [countRows] = await db.query(countSql, params);
    const total = Number(countRows[0]?.total || 0);

    const sql = `
      SELECT
        r.recipient_id,
        r.recipient_code,
        r.recipient_type_id,
        rt.name AS recipient_type_name,
        r.recipient_name,
        r.customer_id AS recipient_customer_id,
        r.is_deleted AS recipient_is_deleted,

        c.id AS customer_id,
        c.code AS customer_code,
        c.name AS customer_name,

        rd.recipient_detail_id,
        rd.recipient_detail_name,
        rd.address,
        rd.subdistrict_id,
        rd.district_id,
        rd.province_id,
        rd.zip_code,
        rd.tel1,
        rd.tel1_ext,
        rd.tel2,
        rd.tel2_ext,
        rd.is_deleted AS detail_is_deleted,
        rd.line_id,
        rd.longitude,
        rd.latitude,

        a.subdistrict_name,
        a.district_name,
        a.province_name,

        COUNT(
          CASE
            WHEN rd.recipient_detail_id IS NOT NULL
            THEN 1
          END
        ) OVER (
          PARTITION BY r.recipient_id
        ) AS address_count

      ${fromSql}
      ${whereSql}

      ORDER BY
        r.recipient_id DESC,
        CASE WHEN rd.is_deleted = 'N' THEN 0 ELSE 1 END,
        rd.recipient_detail_id ASC

      LIMIT ? OFFSET ?
    `;

    const [rows] = await db.query(sql, [...params, pageSize, skip]);

    res.json({
      data: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error("GET RECIPIENTS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const createRecipient = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id } = req.params;

    const { recipient_code, recipient_type_id, recipient_name } = req.body;

    if (!customer_id) {
      return res.status(400).json({ message: "customer_id required" });
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

    if (!recipient_code || !recipient_name) {
      return res.status(400).json({
        message: "recipient_code / recipient_name required",
      });
    }

    const [customerRows] = await db.query(
      `
      SELECT id
      FROM mm_customers
      WHERE id = ?
        AND is_active = 1
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
      SELECT recipient_id
      FROM mm_recipients
      WHERE customer_id = ?
        AND recipient_code = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [customer_id, recipient_code],
    );

    if (exists.length > 0) {
      return res.status(400).json({
        message: "recipient_code นี้มีใน customer นี้แล้ว",
      });
    }

    const [result] = await db.query(
      `
      INSERT INTO mm_recipients (
        recipient_code,
        recipient_type_id,
        recipient_name,
        customer_id,
        is_deleted
      )
      VALUES (?, ?, ?, ?, 'N')
      `,
      [recipient_code, recipient_type_id || null, recipient_name, customer_id],
    );

    res.json({
      message: "create recipient success",
      recipient_id: result.insertId,
    });
  } catch (err) {
    console.error("CREATE RECIPIENT ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const createRecipientDetail = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id, id } = req.params;

    const {
      recipient_detail_name,
      address,
      subdistrict_id,
      district_id,
      province_id,
      zip_code,
      tel1,
      tel1_ext,
      tel2,
      tel2_ext,
      line_id,
      longitude,
      latitude,
    } = req.body;

    if (!customer_id || !id) {
      return res.status(400).json({
        message: "customer_id / recipient_id required",
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

    if (!recipient_detail_name || !address || !tel1) {
      return res.status(400).json({
        message: "recipient_detail_name / address / tel1 required",
      });
    }

    if (!subdistrict_id || !district_id || !province_id) {
      return res.status(400).json({
        message: "subdistrict_id / district_id / province_id required",
      });
    }

    const [recipientRows] = await db.query(
      `
      SELECT recipient_id
      FROM mm_recipients
      WHERE recipient_id = ?
        AND customer_id = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [id, customer_id],
    );

    if (recipientRows.length === 0) {
      return res.status(404).json({
        message: "recipient not found",
      });
    }

    const [result] = await db.query(
      `
      INSERT INTO mm_recipient_details (
        recipient_id,
        recipient_detail_name,
        address,
        subdistrict_id,
        district_id,
        province_id,
        zip_code,
        tel1,
        tel1_ext,
        tel2,
        tel2_ext,
        is_deleted,
        is_default,
        line_id,
        longitude,
        latitude
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N', 'N', ?, ?, ?)
      `,
      [
        id,
        recipient_detail_name,
        address,
        subdistrict_id || null,
        district_id || null,
        province_id || null,
        zip_code || null,
        tel1,
        tel1_ext || null,
        tel2 || null,
        tel2_ext || null,
        line_id || null,
        longitude || null,
        latitude || null,
      ],
    );

    res.json({
      message: "create recipient detail success",
      recipient_detail_id: result.insertId,
    });
  } catch (err) {
    console.error("CREATE RECIPIENT DETAIL ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const updateRecipient = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id, id } = req.params;

    const { mode = "recipient", recipient_code, recipient_type_id, recipient_name, detail = {} } = req.body;

    if (!customer_id || !id) {
      return res.status(400).json({ message: "customer_id / id required" });
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

    const [recipientRows] = await db.query(
      `
      SELECT recipient_id
      FROM mm_recipients
      WHERE recipient_id = ?
        AND customer_id = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [id, customer_id],
    );

    if (recipientRows.length === 0) {
      return res.status(404).json({ message: "recipient not found" });
    }

    if (mode === "recipient") {
      if (!recipient_code || !recipient_name) {
        return res.status(400).json({
          message: "recipient_code / recipient_name required",
        });
      }

      const [exists] = await db.query(
        `
        SELECT recipient_id
        FROM mm_recipients
        WHERE customer_id = ?
          AND recipient_code = ?
          AND recipient_id <> ?
          AND is_deleted = 'N'
        LIMIT 1
        `,
        [customer_id, recipient_code, id],
      );

      if (exists.length > 0) {
        return res.status(400).json({
          message: "recipient_code นี้มีใน customer นี้แล้ว",
        });
      }

      const [result] = await db.query(
        `
        UPDATE mm_recipients SET
          recipient_code = ?,
          recipient_type_id = ?,
          recipient_name = ?
        WHERE recipient_id = ?
          AND customer_id = ?
          AND is_deleted = 'N'
        `,
        [recipient_code, recipient_type_id || null, recipient_name, id, customer_id],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "recipient not found" });
      }

      return res.json({ message: "update recipient success" });
    }

    if (mode === "detail") {
      const {
        recipient_detail_id,
        recipient_detail_name,
        address,
        subdistrict_id,
        district_id,
        province_id,
        zip_code,
        tel1,
        tel1_ext,
        tel2,
        tel2_ext,
        line_id,
        longitude,
        latitude,
      } = detail;

      if (!recipient_detail_id) {
        return res.status(400).json({
          message: "recipient_detail_id required",
        });
      }

      if (!recipient_detail_name || !address || !tel1) {
        return res.status(400).json({
          message: "recipient_detail_name / address / tel1 required",
        });
      }

      if (!subdistrict_id || !district_id || !province_id) {
        return res.status(400).json({
          message: "subdistrict_id / district_id / province_id required",
        });
      }

      const [result] = await db.query(
        `
        UPDATE mm_recipient_details SET
          recipient_detail_name = ?,
          address = ?,
          subdistrict_id = ?,
          district_id = ?,
          province_id = ?,
          zip_code = ?,
          tel1 = ?,
          tel1_ext = ?,
          tel2 = ?,
          tel2_ext = ?,
          line_id = ?,
          longitude = ?,
          latitude = ?
        WHERE recipient_detail_id = ?
          AND recipient_id = ?
        `,
        [
          recipient_detail_name,
          address,
          subdistrict_id || null,
          district_id || null,
          province_id || null,
          zip_code || null,
          tel1,
          tel1_ext || null,
          tel2 || null,
          tel2_ext || null,
          line_id || null,
          longitude || null,
          latitude || null,
          recipient_detail_id,
          id,
        ],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          message: "recipient detail not found",
        });
      }

      return res.json({ message: "update recipient detail success" });
    }

    return res.status(400).json({
      message: "invalid update mode",
    });
  } catch (err) {
    console.error("UPDATE RECIPIENT ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const updateRecipientDetailStatus = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customerId, recipientId, detailId } = req.params;
    const { is_deleted } = req.body;

    if (!["N", "Y"].includes(is_deleted)) {
      return res.status(400).json({ message: "invalid status" });
    }

    if (!customerId || !recipientId || !detailId) {
      return res.status(400).json({
        message: "customerId / recipientId / detailId required",
      });
    }

    if (Number(req.user.role_id) === 2) {
      if (!req.user.customer_id) {
        return res.status(403).json({
          message: "customer user has no customer_id",
        });
      }

      if (String(customerId) !== String(req.user.customer_id)) {
        return res.status(403).json({ message: "forbidden" });
      }
    }

    const [result] = await db.query(
      `
      UPDATE mm_recipient_details rd
      INNER JOIN mm_recipients r
        ON r.recipient_id = rd.recipient_id
      SET rd.is_deleted = ?
      WHERE rd.recipient_detail_id = ?
        AND rd.recipient_id = ?
        AND r.customer_id = ?
        AND r.is_deleted = 'N'
      `,
      [is_deleted, detailId, recipientId, customerId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "recipient detail not found",
      });
    }

    res.json({ message: "update recipient detail status success" });
  } catch (err) {
    console.error("UPDATE RECIPIENT DETAIL STATUS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};
