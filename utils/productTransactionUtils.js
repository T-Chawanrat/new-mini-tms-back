import { toNumberOrNull } from "./cleanText.js";

const createTransactionError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  error.status = 400;
  return error;
};

export const insertInitialProductTransactions = async ({
  conn,
  receiveId,
  createdBy,
  now,
  useDatabaseDataPeriod = false,
  createError = createTransactionError,
}) => {
  const cleanReceiveId = toNumberOrNull(receiveId);
  const cleanCreatedBy = toNumberOrNull(createdBy);

  if (!cleanReceiveId) {
    throw createError("receive_id required for tm_product_transactions");
  }

  if (!cleanCreatedBy) {
    throw createError("user_id required for tm_product_transactions");
  }

  const dataYear = now.getFullYear();
  const dataYearmonth = dataYear * 100 + now.getMonth() + 1;

  const insertTransaction = async (tableName, includeDataPeriod, includeCreatedDate) => {
    const dataPeriodSql = includeDataPeriod
      ? useDatabaseDataPeriod
        ? `, YEAR(NOW()) AS data_year, CAST(DATE_FORMAT(NOW(), '%Y%m') AS UNSIGNED) AS data_yearmonth`
        : `, ? AS data_year, ? AS data_yearmonth`
      : "";
    const dataPeriodParams = includeDataPeriod && !useDatabaseDataPeriod ? [dataYear, dataYearmonth] : [];

    await conn.query(
      `
        INSERT INTO ${tableName} (
          receive_business_id, receive_walkin_id, receive_code, serial_id, serial_no,
          status_message, status_id, datetime, update_date, type,
          warehouse_id, created_by, latitude, longitude, warehouse_name,
          address, province_name, district_name, subdistrict_name, zip_code,
          created_name, username, truck_license_plate, user_id, truck_name,
          truck_id, truck_province, note
          ${includeCreatedDate ? ", created_date" : ""}
          ${includeDataPeriod ? ", data_year, data_yearmonth" : ""}
        )
        SELECT
          receive_serial.receive_business_id,
          receive_serial.receive_walkin_id,
          receive_serial.receive_code,
          receive_serial.serial_id,
          receive_serial.serial_no,
          'รับเข้าระบบ', 1, ?, NULL, 'PUBLIC',
          actor.warehouse_id, actor.id, NULL, NULL, warehouse.warehouse_name,
          receive_serial.address, receive_serial.province_name, receive_serial.district_name,
          receive_serial.subdistrict_name, receive_serial.zip_code,
          TRIM(CONCAT_WS(' ', NULLIF(actor.first_name, ''), NULLIF(actor.last_name, ''))),
          actor.username, NULL, actor.id, NULL, NULL, NULL, NULL
          ${includeCreatedDate ? ", ?" : ""}
          ${dataPeriodSql}
        FROM tm_receive_serials receive_serial
        INNER JOIN um_users actor
          ON actor.id = ?
        LEFT JOIN mm_warehouses_to warehouse
          ON warehouse.warehouse_id = actor.warehouse_id
        WHERE receive_serial.receive_business_id = ?
          AND receive_serial.serial_id IS NOT NULL
          AND receive_serial.serial_no IS NOT NULL
          AND COALESCE(receive_serial.item_is_deleted, 'N') = 'N'
      `,
      [now, ...(includeCreatedDate ? [now] : []), ...dataPeriodParams, cleanCreatedBy, cleanReceiveId],
    );
  };

  await insertTransaction("tm_product_transactions", true, false);
  await insertTransaction("tm_product_transactions_last", false, true);
};
