// server/controllers/receive.import.controller.js

import db from "../config/db.js";
import { buildInsertSql, toNumberOrNull } from "../utils/cleanText.js";
import {
  readExcelRows,
  normalizeImportRow,
  isEmptyImportRow,
  groupRowsByNoBill,
  validateImportHeadRow,
  validateSameBillHeader,
  buildReceiveCodeMapByNoBill,
  getMasterAddressBySubdistrictId,
  getShipperByCustomerAndCode,
  getRequestUserId,
  createImportLog,
  updateImportLogRunning,
  updateImportLogSuccess,
  updateImportLogFailed,
  buildImportHeadData,
  buildImportDetailData,
  buildImportDetailItemData,
  createActiveSerialOrThrow,
} from "../utils/receiveImportUtils.js";

export const importReceivesFromExcel = async (req, res) => {
  const conn = await db.getConnection();

  let transactionStarted = false;
  let importId = null;
  let queueTotal = 0;
  let queueProcessed = 0;

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "กรุณาอัปโหลดไฟล์ Excel",
      });
    }

    const customerId = toNumberOrNull(req.body.customer_id);

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "กรุณาเลือก Customer ก่อนนำเข้า",
      });
    }

    const userId = getRequestUserId(req);

    importId = await createImportLog({
      conn,
      customerId,
      createdBy: userId,
    });

    const excelRows = readExcelRows(req.file.buffer);

    const rows = excelRows.map((row, index) => normalizeImportRow(row, index)).filter((row) => !isEmptyImportRow(row));

    if (rows.length === 0) {
      const error = new Error("ไม่พบข้อมูลในไฟล์ Excel");
      error.statusCode = 400;
      throw error;
    }

    for (const row of rows) {
      const error = validateImportHeadRow(row);

      if (error) {
        const validateError = new Error(error);
        validateError.statusCode = 400;
        throw validateError;
      }
    }

    const groupedRows = groupRowsByNoBill(rows);
    const billGroups = Array.from(groupedRows.entries());

    queueTotal = billGroups.length;

    await updateImportLogRunning({
      conn,
      importId,
      queueTotal,
      updatedBy: userId,
    });

    await conn.beginTransaction();
    transactionStarted = true;

    const addressCache = new Map();
    const shipperCache = new Map();

    const receiveCodeByNoBill = await buildReceiveCodeMapByNoBill({
      conn,
      customerId,
      billGroups,
    });

    const importDate = new Date();

    for (const [noBill, billRows] of billGroups) {
      validateSameBillHeader(billRows);

      const firstRow = billRows[0];

      const recipientAddress = await getMasterAddressBySubdistrictId(conn, firstRow.subdistrict_id, addressCache);

      const shipper = await getShipperByCustomerAndCode({
        conn,
        customerId,
        shipperCode: firstRow.shipper_code,
        cache: shipperCache,
      });

      const shipperAddress = await getMasterAddressBySubdistrictId(conn, shipper.subdistrict_id, addressCache);

      const receiveCode = receiveCodeByNoBill.get(noBill);

      if (!receiveCode) {
        const error = new Error(`NO_BILL ${noBill}: ไม่สามารถสร้าง receive_code ได้`);
        error.statusCode = 400;
        throw error;
      }

      const data = buildImportHeadData({
        row: firstRow,
        customerId,
        shipper,
        receiveCode,
        recipientAddress,
        shipperAddress,
        importDate,
        importId,
      });

      const { sql, values } = buildInsertSql("tm_receive_import_head", data);

      const [headResult] = await conn.query(sql, values);

      const receiveId = headResult.insertId;

      for (const row of billRows) {
        const detailData = buildImportDetailData({
          receiveId,
          row,
        });

        const { sql: detailSql, values: detailValues } = buildInsertSql("tm_receive_import_details", detailData);

        const [detailResult] = await conn.query(detailSql, detailValues);

        const receiveDetailId = detailResult.insertId;

        const productSerial = row.serial_no ? await createActiveSerialOrThrow(conn, row.serial_no) : null;

        const itemData = buildImportDetailItemData({
          receiveDetailId,
          productSerial,
        });

        if (itemData) {
          const { sql: itemSql, values: itemValues } = buildInsertSql("tm_receive_import_detail_items", itemData);

          await conn.query(itemSql, itemValues);
        }
      }

      queueProcessed += 1;
    }

    await conn.commit();
    transactionStarted = false;

    await updateImportLogSuccess({
      conn,
      importId,
      queueTotal,
      queueProcessed,
      updatedBy: userId,
    });

    return res.status(201).json({
      success: true,
      message: "Import receive head สำเร็จ",
      import_id: importId,
      total_rows: rows.length,
      total_bills: billGroups.length,
      inserted_rows: queueProcessed,
    });
  } catch (error) {
    if (transactionStarted) {
      await conn.rollback();
    }

    console.error("IMPORT RECEIVES FROM EXCEL ERROR:", error);

    const statusCode = error.statusCode || 500;
    const errorMessage = error.message || "Import receive head ไม่สำเร็จ";

    await updateImportLogFailed({
      conn,
      importId,
      queueTotal,
      queueProcessed,
      errorMessage,
      updatedBy: getRequestUserId(req),
    });

    return res.status(statusCode).json({
      success: false,
      message: statusCode === 400 ? errorMessage : "Import receive head ไม่สำเร็จ",
      error: errorMessage,
      import_id: importId,
    });
  } finally {
    conn.release();
  }
};
