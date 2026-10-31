const getDataPeriod = (now) => ({
  dataYear: now.getFullYear(),
  dataYearmonth: now.getFullYear() * 100 + now.getMonth() + 1,
});

export const saveDriverProductTransactionFromLast = async ({
  connection,
  serialId,
  serialNo,
  statusMessage,
  statusId,
  warehouseId,
  driverId,
  now,
  latitude,
  longitude,
  updateLocation = false,
}) => {
  const { dataYear, dataYearmonth } = getDataPeriod(now);
  const insertLocationSql = updateLocation ? "?, ?" : "transaction_last.latitude, transaction_last.longitude";
  const insertLocationParams = updateLocation ? [latitude, longitude] : [];
  const updateLocationSql = updateLocation ? ", latitude = ?, longitude = ?" : "";
  const updateLocationParams = updateLocation ? [latitude, longitude] : [];

  await connection.query(
    `INSERT INTO tm_product_transactions (
       receive_business_id, receive_walkin_id, receive_code, serial_id, serial_no,
       status_message, status_id, datetime, update_date, type, warehouse_id, created_by,
       latitude, longitude, warehouse_name, address, province_name, district_name,
       subdistrict_name, zip_code, created_name, username, user_id, data_year, data_yearmonth
     )
     SELECT receive_business_id, receive_walkin_id, receive_code, serial_id, serial_no,
            ?, ?, ?, ?, NULL, ?, ?,
            ${insertLocationSql}, warehouse_name, address, province_name, district_name,
            subdistrict_name, zip_code, created_name, username, user_id, ?, ?
     FROM tm_product_transactions_last transaction_last
     WHERE serial_id = ? AND serial_no = ?`,
    [
      statusMessage,
      statusId,
      now,
      now,
      warehouseId,
      driverId,
      ...insertLocationParams,
      dataYear,
      dataYearmonth,
      serialId,
      serialNo,
    ],
  );

  await connection.query(
    `UPDATE tm_product_transactions_last
     SET status_message = ?, status_id = ?, datetime = ?, update_date = ?,
         type = NULL, warehouse_id = ?, created_by = ?${updateLocationSql}
     WHERE serial_id = ? AND serial_no = ?`,
    [
      statusMessage,
      statusId,
      now,
      now,
      warehouseId,
      driverId,
      ...updateLocationParams,
      serialId,
      serialNo,
    ],
  );
};
