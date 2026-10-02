const PRODUCT_TRUCK_LOG_COLUMNS = [
  "product_truck_id",
  "serial_id",
  "serial_no",
  "event_type",
  "created_by",
  "user_truck_id",
  "driver_name",
  "truck_id",
  "truck_license_plate",
  "license_plate_province_id",
  "status",
  "truck_load_id",
  "is_dc_mismatch",
  "parcel_to_warehouse_id",
  "truck_to_warehouse_id",
  "created_date",
];

const PRODUCT_WAREHOUSE_LOG_COLUMNS = [
  "product_warehouse_id",
  "serial_id",
  "serial_no",
  "event_type",
  "now_warehouse_id",
  "to_warehouse_id",
  "created_by",
  "created_date",
];

const insertLog = async (connection, tableName, allowedColumns, payload) => {
  const columns = allowedColumns.filter((column) => payload[column] !== undefined);

  if (!columns.length) {
    throw new Error(`ไม่มีข้อมูลสำหรับบันทึก ${tableName}`);
  }

  const placeholders = columns.map(() => "?").join(", ");
  const values = columns.map((column) => payload[column]);

  await connection.query(
    `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`,
    values,
  );
};

export const insertProductTruckLog = (connection, payload) =>
  insertLog(connection, "logs_product_trucks", PRODUCT_TRUCK_LOG_COLUMNS, payload);

export const insertProductWarehouseLog = (connection, payload) =>
  insertLog(connection, "logs_product_warehouses", PRODUCT_WAREHOUSE_LOG_COLUMNS, payload);
