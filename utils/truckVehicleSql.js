export const buildTruckVehicleSql = ({
  vehicleAlias = "vehicle",
  contractorVehicleAlias = "contractor_vehicle",
  contractorProvinceAlias = "contractor_province",
} = {}) => ({
  licensePlate: `COALESCE(${vehicleAlias}.license_plate, ${contractorVehicleAlias}.license_plate)`,
  licensePlateProvinceId: `COALESCE(${vehicleAlias}.license_plate_province_id, ${contractorVehicleAlias}.license_plate_province_id)`,
  licenseProvince: `COALESCE(${vehicleAlias}.license_plate_province, ${contractorProvinceAlias}.province_name)`,
  model: `COALESCE(${vehicleAlias}.model, ${contractorVehicleAlias}.model)`,
});
