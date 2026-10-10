const OIL_PRICE_URL = "https://orapiweb.pttor.com/oilservice/OilPrice.asmx";

const decodeXmlEntities = (value) => value
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");

const readXmlValue = (xml, tag) => {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match?.[1]?.trim() || null;
};

export const getCurrentOilPrices = async () => {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
    <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <CurrentOilPrice xmlns="http://www.pttor.com"><Language>TH</Language></CurrentOilPrice>
      </soap:Body>
    </soap:Envelope>`;

  const response = await fetch(OIL_PRICE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '"https://orapiweb.pttor.com/CurrentOilPrice"',
    },
    body: soapBody,
  });

  if (!response.ok) throw new Error(`PTT OilPrice returned ${response.status}`);

  const soapXml = await response.text();
  const resultMatch = soapXml.match(/<CurrentOilPriceResult[^>]*>([\s\S]*?)<\/CurrentOilPriceResult>/);
  if (!resultMatch) throw new Error("PTT OilPrice response is invalid");

  const fuelXml = decodeXmlEntities(resultMatch[1]);
  const items = [...fuelXml.matchAll(/<FUEL>([\s\S]*?)<\/FUEL>/g)]
    .map((match) => ({
      product: readXmlValue(match[1], "PRODUCT"),
      price: Number(readXmlValue(match[1], "PRICE")),
      priceDate: readXmlValue(match[1], "PRICE_DATE"),
    }))
    .filter((item) => item.product && Number.isFinite(item.price));

  if (!items.length) throw new Error("PTT OilPrice has no fuel data");

  return { updatedAt: items[0].priceDate, items };
};
