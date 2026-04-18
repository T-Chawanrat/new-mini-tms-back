import db from "../config/db.js";

export const getShipments = async (req, res) => {
  try {
    const user = req.user;

    let where = "WHERE 1=1";
    const params = [];

    // CUSTOMER
    if (user.role_id === 3) {
      where += " AND s.customer_id = ?";
      params.push(user.customer_id);
    }

    // ADMIN / DC
    if ([4, 6].includes(user.role_id)) {
      where += " AND s.warehouse_id = ?";
      params.push(user.warehouse_id);
    }

    // MANAGER
    if (user.role_id === 5) {
      where += `
        AND s.warehouse_id IN (
          SELECT warehouse_id
          FROM mm_warehouse_zones
          WHERE zone_id IN (
            SELECT zone_id FROM um_user_zones WHERE user_id = ?
          )
        )
      `;
      params.push(user.id);
    }

    // DRIVER
    if (user.role_id === 8) {
      where += `
        AND s.id IN (
          SELECT dji.shipment_id
          FROM delivery_job_items dji
          JOIN delivery_jobs dj ON dji.delivery_job_id = dj.id
          WHERE dj.driver_id = ?
        )
      `;
      params.push(user.id);
    }

    const [rows] = await db.query(
      `
      SELECT s.*
      FROM shipments s
      ${where}
      ORDER BY s.created_at DESC
      `,
      params
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};