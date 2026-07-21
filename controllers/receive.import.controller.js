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
  getPackageByCode,
  insertImportReceiveReference,
  insertImportReceiveStatus,
  insertImportReceiveSerials,
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
    const packageCache = new Map();

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

      await insertImportReceiveReference({
        conn,
        referenceNo: firstRow.reference_no,
        receiveId,
      });

      await insertImportReceiveStatus({
        conn,
        receiveId,
        receiveCode,
      });

      for (const row of billRows) {
        const packageData = await getPackageByCode({
          conn,
          customerId,
          packageCode: row.package_code,
          q: row.q,
          weight: row.weight,
          cache: packageCache,
        });

        const detailData = buildImportDetailData({
          receiveId,
          row,
          packageData,
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

      await insertImportReceiveSerials(conn, receiveId);

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

export const validateReceiveImportRows = async (req, res) => {
  const conn = await db.getConnection();

  try {
    const customerId = toNumberOrNull(req.body.customer_id);
    const inputRows = req.body.rows;

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "กรุณาเลือก Customer ก่อนตรวจสอบข้อมูล",
      });
    }

    if (!Array.isArray(inputRows) || inputRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ไม่พบข้อมูลสำหรับตรวจสอบ",
      });
    }

    const rows = inputRows.map((row, index) => normalizeImportRow(row, index)).filter((row) => !isEmptyImportRow(row));

    const invalidRows = {};

    const addressCache = new Map();
    const shipperCache = new Map();

    const addError = (index, field, message) => {
      if (!invalidRows[index]) {
        invalidRows[index] = {};
      }

      invalidRows[index][field] = message;
    };

    const normalizeCompare = (value) => {
      return String(value || "").trim();
    };

    const pickAddressValue = (address, keys) => {
      for (const key of keys) {
        if (address?.[key] !== undefined && address?.[key] !== null) {
          return address[key];
        }
      }

      return "";
    };

    for (const row of rows) {
      const index = row.row_index ?? row.__row_index ?? row.index ?? 0;

      const subdistrictId = toNumberOrNull(row.subdistrict_id);
      const shipperCode = String(row.shipper_code || "").trim();

      if (!subdistrictId) {
        addError(index, "subdistrict_id", "ไม่มี subdistrict_id");
      } else {
        try {
          const recipientAddress = await getMasterAddressBySubdistrictId(conn, subdistrictId, addressCache);

          const masterSubdistrict = normalizeCompare(
            pickAddressValue(recipientAddress, ["subdistrict_name", "subdistrict", "SUBDISTRICT_NAME", "SUBDISTRICT", "name_th"]),
          );

          const masterDistrict = normalizeCompare(
            pickAddressValue(recipientAddress, ["district_name", "district", "DISTRICT_NAME", "DISTRICT", "amphur_name"]),
          );

          const masterProvince = normalizeCompare(pickAddressValue(recipientAddress, ["province_name", "province", "PROVINCE_NAME", "PROVINCE"]));

          const masterZipcode = normalizeCompare(pickAddressValue(recipientAddress, ["zipcode", "zip_code", "ZIPCODE", "ZIP_CODE", "postcode"]));

          const excelSubdistrict = normalizeCompare(row.recipient_subdistrict);
          const excelDistrict = normalizeCompare(row.recipient_district);
          const excelProvince = normalizeCompare(row.recipient_province);
          const excelZipcode = normalizeCompare(row.recipient_zipcode);

          const canCompareAddress = masterSubdistrict || masterDistrict || masterProvince || masterZipcode;

          const isAddressNotMatch =
            canCompareAddress &&
            (excelSubdistrict !== masterSubdistrict ||
              excelDistrict !== masterDistrict ||
              excelProvince !== masterProvince ||
              excelZipcode !== masterZipcode);

          if (isAddressNotMatch) {
            addError(index, "address", "ที่อยู่ไม่ตรงกับ subdistrict_id ในฐานข้อมูล");
          }
        } catch (error) {
          addError(index, "subdistrict_id", error.message || "ไม่พบ subdistrict_id ในระบบ");
        }
      }

      if (!shipperCode) {
        addError(index, "SHIPPER_CODE", "ไม่มี SHIPPER_CODE");
      } else {
        try {
          await getShipperByCustomerAndCode({
            conn,
            customerId,
            shipperCode,
            cache: shipperCache,
          });
        } catch (error) {
          addError(index, "SHIPPER_CODE", error.message || "ไม่พบ SHIPPER_CODE ของ Customer นี้");
        }
      }
    }

    return res.json({
      success: true,
      invalidRows,
    });
  } catch (error) {
    console.error("VALIDATE RECEIVE IMPORT ROWS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "ตรวจสอบข้อมูลกับฐานข้อมูลไม่สำเร็จ",
      error: error.message,
    });
  } finally {
    conn.release();
  }
};
