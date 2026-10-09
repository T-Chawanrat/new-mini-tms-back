import db from "../../config/db.js";
import { toNumberOrNull } from "../../utils/input.js";
import { buildTruckVehicleSql } from "../../utils/truck.js";

const truckVehicleSql = buildTruckVehicleSql();

const getActorId = (req) => toNumberOrNull(req.user?.id ?? req.user?.user_id);

// รายการงานที่ผูกกับผู้ขับรถที่เข้าสู่ระบบเท่านั้น
// DC_TRUCK = ใบรถกระจาย (DT), DC_TRUCK_DC = ใบปิดบรรทุก (TK)
export const getDriverTrucks = async (req, res) => {
  try {
    const driverId = getActorId(req);

    if (!driverId) {
      return res.status(400).json({ success: false, message: "ข้อมูลผู้ขับรถไม่ถูกต้อง" });
    }

    const [rows] = await db.query(
      `
        SELECT
          truck.id AS truck_load_id,
          truck.truck_code,
          truck.create_date,
          truck.status,
          truck.is_close,
          truck.is_go,
          truck.is_completed,
          ${truckVehicleSql.licensePlate} AS license_plate,
          ${truckVehicleSql.licenseProvince} AS license_plate_province,
          route.route_code,
          route.route_name,
          COALESCE(truck_count.count_box, 0) AS count_box
        FROM tm_trucks truck
        LEFT JOIN mm_vehicles vehicle ON vehicle.id = truck.vehicle_id
        LEFT JOIN mm_vehicles_contractor contractor_vehicle ON contractor_vehicle.id = truck.vehicle_contractor_id
        LEFT JOIN mm_province contractor_province ON contractor_province.id = contractor_vehicle.license_plate_province_id
        LEFT JOIN tm_truck_count truck_count ON truck_count.truck_load_id = truck.id
        LEFT JOIN mm_routes route ON route.route_id = truck.route_id
        WHERE truck.status IN ('DC_TRUCK', 'DC_TRUCK_DC')
          AND truck.user_truck_id = ?
          AND COALESCE(truck.is_deleted, 'N') = 'N'
        ORDER BY truck.id DESC
      `,
      [driverId],
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getDriverTrucks error:", error);
    return res.status(500).json({ success: false, message: "ไม่สามารถโหลดงานของคุณได้" });
  }
};
