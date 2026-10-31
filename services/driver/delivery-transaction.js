import { saveDriverProductTransactionFromLast } from "./driver.product-transaction.js";

export const saveDriverDeliveryTransactions = async ({ connection, products, now, lat, lng, accuracy, driverId, warehouseId }) => {
for (const product of products) {
      const pair = [product.serial_id, product.serial_no];
      await connection.query(
        `INSERT INTO tm_delivery_close (truck_load_id, serial_id, serial_no, delivery_status, delivered_datetime, source, lat, lng, accuracy_m, created_by, created_date, updated_by, updated_date) VALUES (?, ?, ?, 'COMPLETED', ?, 'DRIVER_APP', ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE truck_load_id = VALUES(truck_load_id), serial_no = VALUES(serial_no), delivery_status = 'COMPLETED', delivered_datetime = VALUES(delivered_datetime), source = 'DRIVER_APP', lat = VALUES(lat), lng = VALUES(lng), accuracy_m = VALUES(accuracy_m), updated_by = VALUES(updated_by), updated_date = VALUES(updated_date)`,
        [product.truck_load_id, ...pair, now, lat, lng, accuracy, driverId, now, driverId, now],
      );
      await saveDriverProductTransactionFromLast({
        connection,
        serialId: product.serial_id,
        serialNo: product.serial_no,
        statusMessage: "จัดส่งสำเร็จ",
        statusId: 18,
        warehouseId,
        driverId,
        now,
        latitude: lat,
        longitude: lng,
        updateLocation: true,
      });
      await connection.query(
        `UPDATE tm_product_trucks SET status = 'DELIVERED' WHERE id = ? AND serial_id = ? AND serial_no = ? AND status = 'IN_TRANSIT'`,
        [product.product_truck_id, ...pair],
      );
      const routeMismatch =
        product.parcel_route_id == null || product.truck_route_id == null
          ? null
          : String(product.parcel_route_id) === String(product.truck_route_id)
            ? "N"
            : "Y";
      await connection.query(
        `INSERT INTO logs_product_trucks (product_truck_id, serial_id, serial_no, event_type, created_by, user_truck_id, driver_name, truck_id, truck_license_plate, license_plate_province_id, status, truck_load_id, is_dc_mismatch, parcel_to_warehouse_id, truck_to_warehouse_id, is_route_mismatch, parcel_route_id, truck_route_id, created_date) VALUES (?, ?, ?, 'DELIVER', ?, ?, ?, ?, ?, ?, 'DELIVERED', ?, 'N', ?, ?, ?, ?, ?, ?)`,
        [
          product.product_truck_id,
          ...pair,
          driverId,
          product.user_truck_id,
          product.driver_name,
          product.truck_id,
          product.truck_license_plate,
          product.license_plate_province_id,
          product.truck_load_id,
          product.parcel_to_warehouse_id,
          product.truck_to_warehouse_id,
          routeMismatch,
          product.parcel_route_id,
          product.truck_route_id,
          now,
        ],
      );
      await connection.query(
        `UPDATE tm_truck_details
         SET is_receive = 'Y', receive_by = ?, receive_date = ?
         WHERE truck_load_id = ? AND serial_id = ? AND serial_no = ?`,
        [driverId, now, product.truck_load_id, ...pair],
      );
      await connection.query(`DELETE FROM tm_product_trucks WHERE id = ? AND serial_id = ? AND serial_no = ?`, [product.product_truck_id, ...pair]);
      await connection.query(`DELETE FROM tm_product_actived WHERE serial_id = ? AND serial_no = ?`, pair);
    }
    };

