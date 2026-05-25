import db from "../config/db.js";
import { cleanValue, cleanCode, toNumberOrNull } from "../utils/cleanText.js";

const CUSTOMER_ROLE_ID = 2;

const getPackageDetailTable = (type) => {
  if (type === "BUSINESS") return "mm_package_business";
  if (type === "EXPRESS") return "mm_package_express";
  return null;
};

const getPackageWithCustomer = async (packageId) => {
  const [rows] = await db.query(
    `
      SELECT
        p.package_id,
        p.package_code,
        p.package_name,
        p.customer_id,
        p.is_deleted,
        p.is_actived,
        p.type AS package_type,
        p.is_document_return,
        p.pay_commission,
        p.create_user_id,
        p.update_user_id,
        p.create_date,
        p.update_date,

        c.code AS customer_code,
        c.name AS customer_name,
        c.type AS customer_type,
        c.is_active AS customer_is_active
      FROM mm_packages p
      INNER JOIN mm_customers c
        ON c.id = p.customer_id
      WHERE p.package_id = ?
      LIMIT 1
    `,
    [packageId],
  );

  return rows[0] || null;
};

export const getPackages = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { search, customer_id, type, status } = req.query;
    const isCustomer = Number(req.user.role_id) === CUSTOMER_ROLE_ID;

    let sql = `
      SELECT
        p.package_id,
        p.package_code,
        p.package_name,
        p.customer_id,
        p.is_deleted,
        p.is_actived,
        p.type AS package_type,
        p.is_document_return,
        p.pay_commission,
        p.create_date,
        p.update_date,

        c.code AS customer_code,
        c.name AS customer_name,
        c.type AS customer_type,

        CASE
          WHEN p.type = 'BUSINESS' THEN (
            SELECT COUNT(*)
            FROM mm_package_business pb
            WHERE pb.package_id = p.package_id
              AND pb.is_deleted = 'N'
          )
          WHEN p.type = 'EXPRESS' THEN (
            SELECT COUNT(*)
            FROM mm_package_express pe
            WHERE pe.package_id = p.package_id
              AND pe.is_deleted = 'N'
          )
          ELSE 0
        END AS detail_count

      FROM mm_packages p
      INNER JOIN mm_customers c
        ON c.id = p.customer_id
      WHERE p.is_deleted = 'N'
    `;

    const params = [];

    if (isCustomer) {
      sql += `
        AND p.customer_id = ?
      `;
      params.push(req.user.customer_id);
    } else if (customer_id) {
      sql += ` AND p.customer_id = ?`;
      params.push(customer_id);
    } else {
      return res.json([]);
    }

    if (type) {
      sql += ` AND p.type = ?`;
      params.push(type);
    }

    if (!isCustomer && status) {
      sql += ` AND p.is_actived = ?`;
      params.push(status);
    }

    if (search) {
      sql += `
        AND (
          p.package_code LIKE ?
          OR p.package_name LIKE ?
          OR c.code LIKE ?
          OR c.name LIKE ?
        )
      `;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY p.package_id DESC`;

    const [rows] = await db.query(sql, params);

    res.json(rows);
  } catch (err) {
    console.error("getPackages error:", err);
    res.status(500).json({ message: err.message });
  }
};

export const getPackageById = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;
    const isCustomer = Number(req.user.role_id) === CUSTOMER_ROLE_ID;

    const packageRow = await getPackageWithCustomer(id);

    if (!packageRow || packageRow.is_deleted === "Y") {
      return res.status(404).json({ message: "package not found" });
    }

    if (isCustomer) {
      if (Number(packageRow.customer_id) !== Number(req.user.customer_id)) {
        return res.status(403).json({ message: "forbidden" });
      }

      if (packageRow.is_actived !== "Y") {
        return res.status(404).json({ message: "package not found" });
      }
    }

    const detailTable = getPackageDetailTable(packageRow.package_type);

    if (!detailTable) {
      return res.status(400).json({ message: "invalid package type" });
    }

    let sql = `
      SELECT *
      FROM ${detailTable}
      WHERE package_id = ?
        AND is_deleted = 'N'
    `;

    if (isCustomer) {
      sql += ` AND is_actived = 'Y'`;
    }

    sql += ` ORDER BY id ASC`;

    const [details] = await db.query(sql, [id]);

    res.json({
      ...packageRow,
      details,
    });
  } catch (err) {
    console.error("getPackageById error:", err);
    res.status(500).json({ message: err.message });
  }
};

export const createPackage = async (req, res) => {
  const conn = await db.getConnection();

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { package_code, package_name, customer_id, is_document_return = "N", pay_commission = null } = req.body;

    if (!package_code || !package_name || !customer_id) {
      return res.status(400).json({
        message: "package_code, package_name and customer_id are required",
      });
    }

    await conn.beginTransaction();

    const [[customer]] = await conn.query(
      `
        SELECT id, type
        FROM mm_customers
        WHERE id = ?
          AND is_active = 1
        LIMIT 1
      `,
      [customer_id],
    );

    if (!customer) {
      await conn.rollback();
      return res.status(404).json({ message: "customer not found" });
    }

    const [duplicates] = await conn.query(
      `
        SELECT package_id
        FROM mm_packages
        WHERE package_code = ?
          AND customer_id = ?
          AND is_deleted = 'N'
        LIMIT 1
      `,
      [cleanCode(package_code), customer_id],
    );

    if (duplicates.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        message: "package_code already exists for this customer",
      });
    }

    const [result] = await conn.query(
      `
        INSERT INTO mm_packages (
          package_code,
          package_name,
          customer_id,
          is_deleted,
          create_user_id,
          create_date,
          is_document_return,
          type,
          is_actived,
          pay_commission
        )
        VALUES (?, ?, ?, 'N', ?, NOW(), ?, ?, 'Y', ?)
      `,
      [
        cleanCode(package_code),
        cleanValue(package_name),
        customer_id,
        req.user.id,
        is_document_return || "N",
        customer.type,
        cleanValue(pay_commission),
      ],
    );

    await conn.commit();

    res.status(201).json({
      message: "created",
      package_id: result.insertId,
    });
  } catch (err) {
    await conn.rollback();
    console.error("createPackage error:", err);
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

export const updatePackage = async (req, res) => {
  const conn = await db.getConnection();

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;

    const { package_code, package_name, is_document_return = "N", pay_commission = null } = req.body;

    if (!package_code || !package_name) {
      return res.status(400).json({
        message: "package_code and package_name are required",
      });
    }

    await conn.beginTransaction();

    const packageRow = await getPackageWithCustomer(id);

    if (!packageRow || packageRow.is_deleted === "Y") {
      await conn.rollback();
      return res.status(404).json({ message: "package not found" });
    }

    const [duplicates] = await conn.query(
      `
        SELECT package_id
        FROM mm_packages
        WHERE package_code = ?
          AND customer_id = ?
          AND package_id <> ?
          AND is_deleted = 'N'
        LIMIT 1
      `,
      [cleanCode(package_code), packageRow.customer_id, id],
    );

    if (duplicates.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        message: "package_code already exists for this customer",
      });
    }

    await conn.query(
      `
        UPDATE mm_packages
        SET
          package_code = ?,
          package_name = ?,
          is_document_return = ?,
          pay_commission = ?,
          update_user_id = ?,
          update_date = NOW()
        WHERE package_id = ?
      `,
      [cleanCode(package_code), cleanValue(package_name), is_document_return || "N", cleanValue(pay_commission), req.user.id, id],
    );

    await conn.commit();

    res.json({ message: "updated" });
  } catch (err) {
    await conn.rollback();
    console.error("updatePackage error:", err);
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

export const updatePackageStatus = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;
    const { is_actived } = req.body;

    if (!["Y", "N"].includes(is_actived)) {
      return res.status(400).json({ message: "invalid status" });
    }

    const packageRow = await getPackageWithCustomer(id);

    if (!packageRow || packageRow.is_deleted === "Y") {
      return res.status(404).json({ message: "package not found" });
    }

    await db.query(
      `
        UPDATE mm_packages
        SET
          is_actived = ?,
          update_user_id = ?,
          update_date = NOW()
        WHERE package_id = ?
      `,
      [is_actived, req.user.id, id],
    );

    res.json({ message: "updated" });
  } catch (err) {
    console.error("updatePackageStatus error:", err);
    res.status(500).json({ message: err.message });
  }
};

export const createPackageDetail = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;

    const packageRow = await getPackageWithCustomer(id);

    if (!packageRow || packageRow.is_deleted === "Y") {
      return res.status(404).json({ message: "package not found" });
    }

    const detailTable = getPackageDetailTable(packageRow.package_type);

    if (!detailTable) {
      return res.status(400).json({ message: "invalid package type" });
    }

    const {
      package_detail_code,
      package_detail_name,
      size_min,
      size_max,
      weight_min,
      weight_max,
      cost,
      cost_difference_warehouse,
      cost_go,
      cost_return,
      is_document_return = "N",
      is_weight_fix = "N",
      is_vat = "N",
      package_setting_id,
    } = req.body;

    const unit_id = 1;

    if (packageRow.package_type === "BUSINESS") {
      const [result] = await db.query(
        `
          INSERT INTO mm_package_business (
            package_detail_code,
            package_detail_name,
            unit_id,
            is_deleted,
            size_min,
            size_max,
            weight_min,
            weight_max,
            cost,
            is_actived,
            cost_difference_warehouse,
            create_user_id,
            created_date,
            is_document_return,
            cost_go,
            cost_return,
            is_weight_fix,
            is_vat,
            package_id
          )
          VALUES (?, ?, ?, 'N', ?, ?, ?, ?, ?, 'Y', ?, ?, NOW(), ?, ?, ?, ?, ?, ?)
        `,
        [
          cleanCode(package_detail_code) || null,
          cleanValue(package_detail_name),
          unit_id,
          toNumberOrNull(size_min),
          toNumberOrNull(size_max),
          toNumberOrNull(weight_min),
          toNumberOrNull(weight_max),
          toNumberOrNull(cost),
          toNumberOrNull(cost_difference_warehouse),
          req.user.id,
          is_document_return || "N",
          toNumberOrNull(cost_go),
          toNumberOrNull(cost_return),
          is_weight_fix || "N",
          is_vat || "N",
          id,
        ],
      );

      return res.status(201).json({
        message: "created",
        detail_id: result.insertId,
      });
    }

    const [result] = await db.query(
      `
        INSERT INTO mm_package_express (
          package_detail_code,
          package_detail_name,
          unit_id,
          is_deleted,
          size_min,
          size_max,
          weight_min,
          weight_max,
          cost,
          is_actived,
          cost_difference_warehouse,
          package_id,
          package_setting_id,
          cost_go,
          cost_return,
          create_user_id,
          is_document_return
        )
        VALUES (?, ?, ?, 'N', ?, ?, ?, ?, ?, 'Y', ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        cleanCode(package_detail_code) || null,
        cleanValue(package_detail_name),
        unit_id,
        toNumberOrNull(size_min),
        toNumberOrNull(size_max),
        toNumberOrNull(weight_min),
        toNumberOrNull(weight_max),
        toNumberOrNull(cost),
        toNumberOrNull(cost_difference_warehouse),
        id,
        toNumberOrNull(package_setting_id),
        toNumberOrNull(cost_go),
        toNumberOrNull(cost_return),
        req.user.id,
        is_document_return || "N",
      ],
    );

    res.status(201).json({
      message: "created",
      detail_id: result.insertId,
    });
  } catch (err) {
    console.error("createPackageDetail error:", err);
    res.status(500).json({ message: err.message });
  }
};

export const updatePackageDetail = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id, detailId } = req.params;

    const packageRow = await getPackageWithCustomer(id);

    if (!packageRow || packageRow.is_deleted === "Y") {
      return res.status(404).json({ message: "package not found" });
    }

    const {
      package_detail_code,
      package_detail_name,
      size_min,
      size_max,
      weight_min,
      weight_max,
      cost,
      cost_difference_warehouse,
      cost_go,
      cost_return,
      is_document_return = "N",
      is_weight_fix = "N",
      is_vat = "N",
      package_setting_id,
    } = req.body;

    const unit_id = 1;

    if (packageRow.package_type === "BUSINESS") {
      const [result] = await db.query(
        `
          UPDATE mm_package_business
          SET
            package_detail_code = ?,
            package_detail_name = ?,
            unit_id = ?,
            size_min = ?,
            size_max = ?,
            weight_min = ?,
            weight_max = ?,
            cost = ?,
            cost_difference_warehouse = ?,
            update_user_id = ?,
            updated_date = NOW(),
            is_document_return = ?,
            cost_go = ?,
            cost_return = ?,
            is_weight_fix = ?,
            is_vat = ?
          WHERE id = ?
            AND package_id = ?
            AND is_deleted = 'N'
        `,
        [
          cleanCode(package_detail_code) || null,
          cleanValue(package_detail_name),
          unit_id,
          toNumberOrNull(size_min),
          toNumberOrNull(size_max),
          toNumberOrNull(weight_min),
          toNumberOrNull(weight_max),
          toNumberOrNull(cost),
          toNumberOrNull(cost_difference_warehouse),
          req.user.id,
          is_document_return || "N",
          toNumberOrNull(cost_go),
          toNumberOrNull(cost_return),
          is_weight_fix || "N",
          is_vat || "N",
          detailId,
          id,
        ],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "package detail not found" });
      }

      return res.json({ message: "updated" });
    }

    const [result] = await db.query(
      `
        UPDATE mm_package_express
        SET
          package_detail_code = ?,
          package_detail_name = ?,
          unit_id = ?,
          size_min = ?,
          size_max = ?,
          weight_min = ?,
          weight_max = ?,
          cost = ?,
          cost_difference_warehouse = ?,
          package_setting_id = ?,
          cost_go = ?,
          cost_return = ?,
          is_document_return = ?
        WHERE id = ?
          AND package_id = ?
          AND is_deleted = 'N'
      `,
      [
        cleanCode(package_detail_code) || null,
        cleanValue(package_detail_name),
        unit_id,
        toNumberOrNull(size_min),
        toNumberOrNull(size_max),
        toNumberOrNull(weight_min),
        toNumberOrNull(weight_max),
        toNumberOrNull(cost),
        toNumberOrNull(cost_difference_warehouse),
        toNumberOrNull(package_setting_id),
        toNumberOrNull(cost_go),
        toNumberOrNull(cost_return),
        is_document_return || "N",
        detailId,
        id,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "package detail not found" });
    }

    res.json({ message: "updated" });
  } catch (err) {
    console.error("updatePackageDetail error:", err);
    res.status(500).json({ message: err.message });
  }
};

export const updatePackageDetailStatus = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id, detailId } = req.params;
    const { is_actived } = req.body;

    if (!["Y", "N"].includes(is_actived)) {
      return res.status(400).json({ message: "invalid status" });
    }

    const packageRow = await getPackageWithCustomer(id);

    if (!packageRow || packageRow.is_deleted === "Y") {
      return res.status(404).json({ message: "package not found" });
    }

    const detailTable = getPackageDetailTable(packageRow.package_type);

    if (!detailTable) {
      return res.status(400).json({ message: "invalid package type" });
    }

    const [result] = await db.query(
      `
        UPDATE ${detailTable}
        SET is_actived = ?
        WHERE id = ?
          AND package_id = ?
          AND is_deleted = 'N'
      `,
      [is_actived, detailId, id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "package detail not found" });
    }

    res.json({ message: "updated" });
  } catch (err) {
    console.error("updatePackageDetailStatus error:", err);
    res.status(500).json({ message: err.message });
  }
};
