const YN_VALUES = new Set(["Y", "N"]);

export const cleanYN = (value) => {
  const cleanValue = String(value ?? "").trim().toUpperCase();
  return YN_VALUES.has(cleanValue) ? cleanValue : null;
};

export const syncTruckBoxCount = async (connection, truckLoadId) => {
  const [countRows] = await connection.query(
    `SELECT COUNT(*) AS count_box FROM tm_truck_details WHERE truck_load_id = ?`,
    [truckLoadId],
  );
  const countBox = Number(countRows[0]?.count_box || 0);

  const [existingRows] = await connection.query(
    `SELECT id FROM tm_truck_count WHERE truck_load_id = ? LIMIT 1`,
    [truckLoadId],
  );

  if (existingRows.length) {
    await connection.query(
      `UPDATE tm_truck_count SET count_box = ? WHERE id = ?`,
      [countBox, existingRows[0].id],
    );
  } else {
    await connection.query(
      `INSERT INTO tm_truck_count (truck_load_id, count_box) VALUES (?, ?)`,
      [truckLoadId, countBox],
    );
  }

  return countBox;
};
