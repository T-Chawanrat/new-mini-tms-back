export const insertShipmentStatus = async (
  connection,
  {
    importLogId,
    userId,
  },
) => {
  const [rows] = await connection.query(
    `
    SELECT id, warehouse_id
    FROM shipments
    WHERE import_log_id = ?
    `,
    [importLogId],
  );

  const [[status]] = await connection.query(
    `
    SELECT id
    FROM mm_status
    WHERE name = 'รับเข้าระบบ'
    LIMIT 1
    `,
  );

  const statusLogs = rows.map((r) => [
    r.id,
    status.id,
    r.warehouse_id,
    userId,
  ]);

  if (statusLogs.length) {
    await connection.query(
      `
      INSERT INTO logs_shipment_status (
        shipment_id,
        status_id,
        warehouse_id,
        user_id
      )
      VALUES ?
      `,
      [statusLogs],
    );
  }
};