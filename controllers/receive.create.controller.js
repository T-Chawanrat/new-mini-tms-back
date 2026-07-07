// server/controllers/create.receive.controller.js

import db from "../config/db.js";
import { cleanTel } from "../utils/cleanTel.js";
import { formatDateOnly } from "../utils/formatDate.js";

import { cleanCode, cleanDbText, toNumberOrNull, toNumberOrZero, toYN, buildInsertSql } from "../utils/cleanText.js";

import {
  generateReceiveCode,
  getFromWarehouseIdByShipper,
  getToWarehouseIdByRecipientDetail,
  normalizePackageRows,
  buildReceiveDetailData,
  buildReceiveDetailItems,
  createActiveSerialOrThrow,
  insertCreateReceiveSerials,
} from "../utils/receiveUtils.js";

export const createReceive = async (req, res) => {
  const conn = await db.getConnection();
  let transactionStarted = false;

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const isCustomer = Number(req.user.role_id) === 2;

    const body = req.body || {};
    const receiveHeader = body.receiveHeader || body;
    const packageRows = normalizePackageRows(body.packageRows);

    const finalCustomerId = isCustomer ? toNumberOrNull(req.user.customer_id) : toNumberOrNull(receiveHeader.customer_id);

    const shipperId = toNumberOrNull(receiveHeader.shipper_id);
    const recipientId = toNumberOrNull(receiveHeader.recipient_id);
    const recipientDetailId = toNumberOrNull(receiveHeader.recipient_detail_id);

    if (!finalCustomerId) {
      return res.status(400).json({ message: "กรุณาเลือกเจ้าของงาน" });
    }

    if (!shipperId) {
      return res.status(400).json({ message: "กรุณาเลือกผู้ส่ง" });
    }

    if (!recipientId) {
      return res.status(400).json({ message: "กรุณาเลือกผู้รับ" });
    }

    if (!recipientDetailId) {
      return res.status(400).json({ message: "กรุณาเลือกที่อยู่ผู้รับ" });
    }

    if (!cleanDbText(receiveHeader.recipient_name)) {
      return res.status(400).json({ message: "กรุณาระบุชื่อผู้รับ" });
    }

    if (!cleanDbText(receiveHeader.address)) {
      return res.status(400).json({ message: "กรุณาระบุที่อยู่ผู้รับ" });
    }

    if (packageRows.length === 0) {
      return res.status(400).json({
        message: "กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ",
      });
    }

    await conn.beginTransaction();
    transactionStarted = true;

    const receiveCode = await generateReceiveCode(conn, finalCustomerId);

    const fromWarehouseId = await getFromWarehouseIdByShipper(conn, shipperId);

    const toWarehouseId = await getToWarehouseIdByRecipientDetail(conn, recipientDetailId);

    const finalIsCod = toYN(receiveHeader.is_cod);
    const finalIsDocumentReturn = toYN(receiveHeader.is_document_return);

    // ติ๊กเอกสารรับกลับได้ แต่ไม่บังคับเลือก dropdown
    // Y + ไม่เลือก = null
    // Y + เลือก = id
    // N = null
    const finalDocumentReturnId =
      finalIsDocumentReturn === "Y" ? toNumberOrNull(receiveHeader.document_return_id ?? receiveHeader.document_return) : null;

    const totalCost = toNumberOrZero(receiveHeader.net ?? receiveHeader.cost ?? receiveHeader.totalPrice ?? body.totalPrice);

    const receiveData = {
      receive_date: new Date(),
      receive_code: receiveCode,

      customer_id: finalCustomerId,
      shipper_id: shipperId,
      recipient_id: recipientId,
      recipient_detail_id: recipientDetailId,

      recipient_name: cleanDbText(receiveHeader.recipient_name),
      address: cleanDbText(receiveHeader.address),

      province_id: toNumberOrNull(receiveHeader.province_id),
      district_id: toNumberOrNull(receiveHeader.district_id),
      subdistrict_id: toNumberOrNull(receiveHeader.subdistrict_id),

      zip_code: cleanCode(receiveHeader.zip_code),
      tel: cleanTel(receiveHeader.tel),

      delivery_date: formatDateOnly(receiveHeader.delivery_date),

      is_cod: finalIsCod,
      cod: finalIsCod === "Y" ? toNumberOrZero(receiveHeader.cod) : 0,

      is_document_return: finalIsDocumentReturn,
      document_return_id: finalDocumentReturnId,

      payment_type_id: toNumberOrNull(receiveHeader.payment_type_id),

      is_deleted: "N",
      is_approved: "N",
      approve_date: null,
      approve_people_id: null,

      from_warehouse_id: fromWarehouseId,
      to_warehouse_id: toWarehouseId,

      status: "CREATE",
      create_date: new Date(),

      is_invoices: "N",
      app_create: "WEB",

      reference_no: cleanCode(receiveHeader.reference_no),
      is_returned: "N",

      remark: cleanDbText(receiveHeader.remark),

      cost: totalCost,
      net: totalCost,

      update_by_user_id: req.user.user_id || req.user.id || null,
      updated_at: new Date(),
    };

    const insertReceive = buildInsertSql("tm_receives", receiveData);

    const [receiveResult] = await conn.query(insertReceive.sql, insertReceive.values);

    const receiveId = receiveResult.insertId;

    let receiveDetailCount = 0;
    let receiveItemCount = 0;
    let autoSerialRunning = 1;

    for (const row of packageRows) {
      const detailData = buildReceiveDetailData({
        receiveId,
        row,
      });

      const insertDetail = buildInsertSql("tm_receive_details", detailData);

      const [detailResult] = await conn.query(insertDetail.sql, insertDetail.values);

      const receiveDetailId = detailResult.insertId;
      receiveDetailCount += 1;

      const builtItems = buildReceiveDetailItems({
        receiveCode,
        receiveDetailId,
        row,
        startRunning: autoSerialRunning,
      });

      const detailItems = builtItems.items;
      autoSerialRunning = builtItems.nextRunning;

      for (const item of detailItems) {
        const productSerial = await createActiveSerialOrThrow(conn, item.serial_no);

        const finalItem = {
          ...item,
          serial_id: productSerial.serial_id,
          serial_no: productSerial.serial_no,
        };

        const insertItem = buildInsertSql("tm_receive_detail_items", finalItem);

        await conn.query(insertItem.sql, insertItem.values);
        receiveItemCount += 1;
      }
    }

    await insertCreateReceiveSerials(conn, receiveId);

    await conn.commit();
    transactionStarted = false;

    return res.status(201).json({
      message: "created",
      receive_id: receiveId,
      receive_code: receiveCode,
      from_warehouse_id: fromWarehouseId,
      to_warehouse_id: toWarehouseId,
      receive_detail_count: receiveDetailCount,
      receive_item_count: receiveItemCount,
    });
  } catch (error) {
    if (transactionStarted) {
      await conn.rollback();
    }

    console.error("CREATE RECEIVE ERROR:", error);

    const statusCode = error.statusCode || error.status || 500;

    return res.status(statusCode).json({
      message: error.message || "create receive failed",
    });
  } finally {
    conn.release();
  }
};