import db from "../../config/db.js";

export const getLabelPrintLogs = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        label_log.*,
        customer.name AS customer_name,
        printer.first_name,
        printer.last_name,
        warehouse.warehouse_name AS to_warehouse_name
      FROM logs_label_print label_log
      LEFT JOIN mm_customers customer ON customer.id = label_log.customer_id
      LEFT JOIN um_users printer ON printer.id = label_log.printed_by_user
      LEFT JOIN mm_warehouses_to warehouse ON warehouse.warehouse_id = label_log.to_warehouse_id
    `);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getLabelPrintLogs error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดประวัติการพิมพ์ได้" });
  }
};

export const getProductTruckLogs = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        truck_log.*,
        creator.first_name,
        creator.last_name,
        warehouse.warehouse_name AS parcel_to_warehouse_name,
        truck.truck_code,
        truck.status AS truck_status,
        truck.route_id,
        route.route_code,
        route.route_name,
        province.province_name AS license_plate_province_name
      FROM logs_product_trucks truck_log
      LEFT JOIN um_users creator ON creator.id = truck_log.created_by
      LEFT JOIN mm_warehouses_to warehouse ON warehouse.warehouse_id = truck_log.parcel_to_warehouse_id
      LEFT JOIN tm_trucks truck ON truck.id = truck_log.truck_load_id
      LEFT JOIN mm_routes route ON route.route_id = truck.route_id
      LEFT JOIN (
        SELECT province_id, MAX(province_name) AS province_name
        FROM mm_master_addresses
        GROUP BY province_id
      ) province ON province.province_id = truck_log.license_plate_province_id
    `);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getProductTruckLogs error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดประวัติสินค้าในรถได้" });
  }
};

export const getProductWarehouseLogs = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        warehouse_log.*,
        warehouse_now.warehouse_name AS now_warehouse_name,
        warehouse_to.warehouse_name AS to_warehouse_name,
        creator.first_name,
        creator.last_name
      FROM logs_product_warehouses warehouse_log
      LEFT JOIN mm_warehouses_to warehouse_now ON warehouse_now.warehouse_id = warehouse_log.now_warehouse_id
      LEFT JOIN mm_warehouses_to warehouse_to ON warehouse_to.warehouse_id = warehouse_log.to_warehouse_id
      LEFT JOIN um_users creator ON creator.id = warehouse_log.created_by
    `);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getProductWarehouseLogs error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดประวัติสินค้าในคลังได้" });
  }
};

export const getReceiveCreateLogs = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        receive_log.*,
        customer.name AS customer_name,
        creator.first_name,
        creator.last_name,
        warehouse.warehouse_name
      FROM logs_receive_create receive_log
      LEFT JOIN mm_customers customer ON customer.id = receive_log.customer_id
      LEFT JOIN um_users creator ON creator.id = receive_log.created_by
      LEFT JOIN mm_warehouses_to warehouse ON warehouse.warehouse_id = receive_log.warehouse_id
    `);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getReceiveCreateLogs error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดประวัติการสร้างใบรับได้" });
  }
};

export const getReceiveImports = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        receive_import.*,
        creator.first_name AS created_by_first_name,
        creator.last_name AS created_by_last_name,
        customer.name AS customer_name,
        updater.first_name AS updated_by_first_name,
        updater.last_name AS updated_by_last_name
      FROM tm_receive_imports receive_import
      LEFT JOIN um_users creator ON creator.id = receive_import.created_by
      LEFT JOIN mm_customers customer ON customer.id = receive_import.customer_id
      LEFT JOIN um_users updater ON updater.id = receive_import.updated_by
    `);
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getReceiveImports error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดประวัติการนำเข้าได้" });
  }
};
