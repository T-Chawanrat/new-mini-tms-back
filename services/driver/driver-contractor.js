export const deactivateContractorIfNoPendingTrucks = async (connection, driverId) => {
  const [result] = await connection.query(
    `UPDATE um_users driver
     SET driver.is_active = 0
     WHERE driver.id = ?
       AND driver.role_id = 7
       AND driver.employment_type = 'CONTRACTOR'
       AND COALESCE(driver.is_active, 1) = 1
       AND NOT EXISTS (
         SELECT 1
         FROM tm_trucks truck
         WHERE truck.user_truck_id = driver.id
           AND COALESCE(truck.is_deleted, 'N') = 'N'
           AND COALESCE(truck.is_completed, 'N') <> 'Y'
       )`,
    [driverId],
  );
  return result.affectedRows > 0;
};
