import db from "../config/db.js";
import { cleanTel } from "../utils/cleanTel.js";
import { cleanValue, cleanCode, toNumberOrNull } from "../utils/cleanText.js";
import { formatDateOnly } from "../utils/formatDate.js";
import { buildLike } from "../utils/cleanText.js";

const CUSTOMER_ROLE = 2;

const yn = (value, defaultValue = "N") => {
  const v = String(value || defaultValue).toUpperCase();
  return v === "Y" ? "Y" : "N";
};

const appCreate = (value = "WEB") => {
  const v = String(value || "WEB").toUpperCase();
  return ["WEB", "API", "IMPORT"].includes(v) ? v : "WEB";
};

export const getReceiveCustomers = async (req, res) => {
  try {
    const { search } = req.query;

    let sql = `
      SELECT
        id,
        code,
        name
      FROM mm_customers
      WHERE is_active = '1'
    `;

    if (search) {
      sql += `
        AND (
          ${buildLike("code", search)}
          OR ${buildLike("name", search)}
        )
      `;
    }

    sql += `
      ORDER BY id ASC
      LIMIT 300
    `;

    const [rows] = await db.query(sql);

    return res.json(rows);
  } catch (err) {
    console.error("GET RECEIVE CUSTOMERS ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const getReceiveShippers = async (req, res) => {
  try {
    const { customer_id } = req.params;
    const { search } = req.query;

    if (!customer_id) {
      return res.status(400).json({ message: "customer_id is required" });
    }

    let whereSql = `
      WHERE s.customer_id = ?
        AND s.is_deleted = 'N'
    `;

    const params = [customer_id];

    if (search) {
      whereSql += `
        AND (
          ${buildLike("s.shipper_code", search)}
          OR ${buildLike("s.shipper_name", search)}
          OR ${buildLike("s.address", search)}
        )
      `;
    }

    const dataSql = `
      SELECT
        s.shipper_id,
        s.shipper_code,
        s.shipper_name,
        s.address,

        s.subdistrict_id,
        s.district_id,
        s.province_id

      FROM mm_shippers s

      ${whereSql}

      ORDER BY s.shipper_id ASC
    `;

    const [rows] = await db.query(dataSql, params);

    return res.json({
      data: rows,
      pagination: {
        page: 1,
        limit: rows.length,
        total: rows.length,
        totalPages: 1,
      },
    });
  } catch (err) {
    console.error("GET RECEIVE SHIPPERS ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const getReceiveRecipients = async (req, res) => {
  try {
    const { customer_id } = req.params;
    const { search } = req.query;

    if (!customer_id) {
      return res.status(400).json({ message: "customer_id is required" });
    }

    let whereSql = `
      WHERE r.customer_id = ?
        AND r.is_deleted = 'N'
    `;

    const params = [customer_id];

    if (search) {
      whereSql += `
        AND (
          ${buildLike("r.recipient_code", search)}
          OR ${buildLike("r.recipient_name", search)}
          OR ${buildLike("rd.recipient_detail_name", search)}
          OR ${buildLike("rd.address", search)}
          OR ${buildLike("rd.tel1", search)}
          )
      `;
    }

    const dataSql = `
      SELECT
        r.recipient_id,
        r.recipient_code,
        r.recipient_name,

        rd.recipient_detail_id,
        rd.recipient_detail_name,
        rd.address,
        rd.subdistrict_id,
        rd.district_id,
        rd.province_id,
        rd.zip_code,
        rd.tel1 AS tel,
        rd.is_default,

        a.subdistrict_name,
        a.district_name,
        a.province_name

      FROM mm_recipients r

      LEFT JOIN mm_recipient_details rd
        ON rd.recipient_id = r.recipient_id
        AND rd.is_deleted = 'N'

      LEFT JOIN mm_master_addresses a
        ON a.subdistrict_id = rd.subdistrict_id
        AND a.district_id = rd.district_id
        AND a.province_id = rd.province_id

      ${whereSql}

      ORDER BY
        r.recipient_id DESC,
        CASE WHEN rd.is_default = 'Y' THEN 0 ELSE 1 END,
        rd.recipient_detail_id DESC
    `;

    const [rows] = await db.query(dataSql, params);

    const total = rows.length;

    return res.json({
      data: rows,
      pagination: {
        page: 1,
        limit: total,
        total,
        totalPages: 1,
      },
    });
  } catch (err) {
    console.error("GET RECEIVE RECIPIENTS ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const getReceivePackages = async (req, res) => {
  try {
    const { customer_id } = req.params;
    const { search } = req.query;

    const searchText = search ? String(search).trim() : "";

    let packageWhere = `
      p.customer_id = ?
      AND p.is_deleted = 'N'
      AND (
        p.is_actived = 'Y'
        OR p.is_actived = '1'
        OR p.is_actived = 1
      )
    `;

    const packageParams = [customer_id];

    if (searchText) {
      packageWhere += `
        AND (
          p.package_name LIKE ?
          OR p.package_code LIKE ?
        )
      `;
      packageParams.push(`%${searchText}%`, `%${searchText}%`);
    }

    const unionSql = `
      SELECT
        p.package_id,
        p.package_code,
        p.package_name,
        p.customer_id,
        p.type,

        d.id AS package_detail_id,
        d.package_detail_code,
        d.package_detail_name,
        d.unit_id,
        d.size_min,
        d.size_max,
        d.weight_min,
        d.weight_max,
        d.cost,
        d.cost_difference_warehouse,
        d.cost_go,
        d.cost_return,
        d.is_document_return,
        d.is_weight_fix,
        d.is_vat,

        'BUSINESS' AS package_detail_type

      FROM mm_packages p

      LEFT JOIN mm_package_business d
        ON d.package_id = p.package_id
        AND d.is_deleted = 'N'
        AND (
          d.is_actived = 'Y'
          OR d.is_actived = '1'
          OR d.is_actived = 1
        )

      WHERE ${packageWhere}
        AND p.type = 'BUSINESS'

      UNION ALL

      SELECT
        p.package_id,
        p.package_code,
        p.package_name,
        p.customer_id,
        p.type,

        d.id AS package_detail_id,
        d.package_detail_code,
        d.package_detail_name,
        d.unit_id,
        d.size_min,
        d.size_max,
        d.weight_min,
        d.weight_max,
        d.cost,
        d.cost_difference_warehouse,
        d.cost_go,
        d.cost_return,
        d.is_document_return,
        NULL AS is_weight_fix,
        NULL AS is_vat,

        'EXPRESS' AS package_detail_type

      FROM mm_packages p

      LEFT JOIN mm_package_express d
        ON d.package_id = p.package_id
        AND d.is_deleted = 'N'
        AND (
          d.is_actived = 'Y'
          OR d.is_actived = '1'
          OR d.is_actived = 1
        )

      WHERE ${packageWhere}
        AND p.type = 'EXPRESS'
    `;

    const dataSql = `
      SELECT *
      FROM (
        ${unionSql}
      ) x
      ORDER BY
        x.package_id ASC,
        x.package_detail_id ASC
    `;

    const dataParams = [...packageParams, ...packageParams];

    const [rows] = await db.query(dataSql, dataParams);

    return res.json({
      data: rows,
    });
  } catch (err) {
    console.error("GET RECEIVE PACKAGES ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const createReceive = async (req, res) => {
  const conn = await db.getConnection();

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const isCustomer = Number(req.user.role_id) === CUSTOMER_ROLE;

    const {
      receive_code,
      customer_id,
      shipper_id,
      recipient_id,
      recipient_detail_id,
      recipient_name,
      address,
      province_id,
      district_id,
      subdistrict_id,
      zip_code,
      tel,
      delivery_date,
      is_cod,
      cod,
      is_document_return,
      document_return,
      payment_type_id,
      from_warehouse_id,
      to_warehouse_id,
      is_pickup_customer,
      is_pickup_shipper,
      is_invoices,
      app_create,
      reference_no,
      is_returned,
      remark,
    } = req.body;

    const finalCustomerId = isCustomer ? req.user.customer_id : customer_id;

    if (!cleanCode(receive_code)) {
      return res.status(400).json({ message: "กรุณาระบุเลข DO" });
    }

    if (!finalCustomerId) {
      return res.status(400).json({ message: "กรุณาเลือกลูกค้า" });
    }

    if (!cleanValue(recipient_name)) {
      return res.status(400).json({ message: "กรุณาระบุชื่อผู้รับ" });
    }

    if (!cleanValue(address)) {
      return res.status(400).json({ message: "กรุณาระบุที่อยู่" });
    }

    await conn.beginTransaction();

    const [dup] = await conn.query(
      `
        SELECT receive_id
        FROM tm_receives
        WHERE receive_code = ?
          AND is_deleted = 'N'
        LIMIT 1
      `,
      [cleanCode(receive_code)],
    );

    if (dup.length) {
      await conn.rollback();
      return res.status(409).json({ message: "เลข DO นี้มีอยู่แล้ว" });
    }

    const finalIsCod = yn(is_cod);
    const finalIsDocumentReturn = yn(is_document_return);

    const [result] = await conn.query(
      `
        INSERT INTO tm_receives (
          receive_date,
          receive_code,
          customer_id,
          shipper_id,
          recipient_id,
          recipient_detail_id,
          recipient_name,
          address,
          province_id,
          district_id,
          subdistrict_id,
          zip_code,
          tel,
          delivery_date,
          is_cod,
          cod,
          is_document_return,
          document_return,
          payment_type_id,
          is_deleted,
          is_approved,
          from_warehouse_id,
          to_warehouse_id,
          create_date,
          is_pickup_customer,
          is_pickup_shipper,
          is_invoices,
          app_create,
          reference_no,
          is_returned,
          remark,
          updated_at
        )
        VALUES (
          NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          'N', 'N',
          ?, ?,
          NOW(),
          ?, ?, ?, ?, ?, ?, ?,
          NOW()
        )
      `,
      [
        cleanCode(receive_code),
        toNumberOrNull(finalCustomerId),
        toNumberOrNull(shipper_id),
        toNumberOrNull(recipient_id),
        toNumberOrNull(recipient_detail_id),
        cleanValue(recipient_name),
        cleanValue(address),
        toNumberOrNull(province_id),
        toNumberOrNull(district_id),
        toNumberOrNull(subdistrict_id),
        cleanCode(zip_code),
        cleanTel(tel),
        formatDateOnly(delivery_date),

        finalIsCod,
        finalIsCod === "Y" ? Number(cod || 0) : 0,

        finalIsDocumentReturn,
        finalIsDocumentReturn === "Y" ? cleanValue(document_return) : null,

        toNumberOrNull(payment_type_id),

        toNumberOrNull(from_warehouse_id),
        toNumberOrNull(to_warehouse_id),

        yn(is_pickup_customer),
        yn(is_pickup_shipper),
        yn(is_invoices),
        appCreate(app_create),

        cleanCode(reference_no),
        yn(is_returned),
        cleanValue(remark),
      ],
    );

    await conn.commit();

    return res.status(201).json({
      message: "created",
      receive_id: result.insertId,
    });
  } catch (error) {
    await conn.rollback();
    console.error("createReceive error:", error);

    return res.status(500).json({
      message: "server error",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};
