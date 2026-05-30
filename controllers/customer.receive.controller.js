import db from "../config/db.js";
import { cleanTel } from "../utils/cleanTel.js";
import {
  cleanValue,
  cleanCode,
  toNumberOrNull,
} from "../utils/cleanText.js";
import { formatDateOnly } from "../utils/formatDate.js";

const yn = (value, defaultValue = "N") => {
  const v = String(value || defaultValue).toUpperCase();
  return v === "Y" ? "Y" : "N";
};

const appCreate = (value = "WEB") => {
  const v = String(value || "WEB").toUpperCase();
  return ["WEB", "API", "IMPORT"].includes(v) ? v : "WEB";
};

export const createCustomerReceive = async (req, res) => {
  const conn = await db.getConnection();

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    if (Number(req.user.role_id) !== 2) {
      return res.status(403).json({ message: "forbidden" });
    }

    if (!req.user.customer_id) {
      return res.status(403).json({ message: "customer user has no customer_id" });
    }

    const {
      receive_code,
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

    if (!cleanCode(receive_code)) {
      return res.status(400).json({ message: "กรุณาระบุเลข DO" });
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
      [cleanCode(receive_code)]
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
        toNumberOrNull(req.user.customer_id),

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
      ]
    );

    await conn.commit();

    return res.status(201).json({
      message: "created",
      receive_id: result.insertId,
    });
  } catch (error) {
    await conn.rollback();
    console.error("createCustomerReceive error:", error);

    return res.status(500).json({
      message: "server error",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};