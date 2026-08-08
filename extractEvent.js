
          let postalCode = null;
          const postalCodeInput = $('input[type="text"][readonly][name="cp"]');
          if (postalCodeInput.length) {
            postalCode = postalCodeInput.val();
          }
        let doorNumber = null;
        const doorInput = $('input[type="text"][readonly][name="porte"]');
        if (doorInput.length) {
          doorNumber = doorInput.val();
        }
      let floor = null;
      const floorInput = $('input[type="text"][readonly][name="etage"]');
      if (floorInput.length) {
        floor = floorInput.val();
      }
    let propertyType = null;
    const propertyTypeInput = $('input[type="text"][readonly][name="type_bien_id"]');
    if (propertyTypeInput.length) {
      propertyType = propertyTypeInput.val();
    }
  let tenantMobile = null;
  const tenantMobileInput = $('input[type="text"][readonly][name="contact_telephone_portable"]');
  if (tenantMobileInput.length) {
    tenantMobile = tenantMobileInput.val();
  }
// Extraction d'un événement à partir d'un HTML de popup Constatimmo
const cheerio = require('cheerio');

function extractEventFromHtml(html) {
  const $ = cheerio.load(html);
  const timeText = $('.fc-event-time').text().trim();
  // Ex: "10:30 - 11:30"
  let start = null, end = null;
  if (timeText.match(/\d{2}:\d{2} - \d{2}:\d{2}/)) {
    [start, end] = timeText.split(' - ');
  }
  // Extraction d'un nom ou titre depuis un input (exemple fourni)
  let name = null;
  let address = null;
  const nameInput = $('input[type="text"][readonly]').first();
  if (nameInput.length) {
    name = nameInput.val();
  }
  const addressInput = $('input[type="text"][readonly][name="adresse"]');
  if (addressInput.length) {
    address = addressInput.val();
  }
  let tenantName = null;
  const tenantInput = $('input[type="text"][readonly][name="nomLocataire"]');
  if (tenantInput.length) {
    tenantName = tenantInput.val();
  }
  let city = null;
  const cityInput = $('input[type="text"][readonly][name="ville"]');
  if (cityInput.length) {
    city = cityInput.val();
  }
  return {
    startTime: start,
    endTime: end,
    name: name,
    address: address,
    tenantName: tenantName,
    tenantMobile: tenantMobile,
    propertyType: propertyType,
    floor: floor,
    doorNumber: doorNumber,
    postalCode: postalCode,
    city: city,
    // title: ...
    // description: ...
  };
}

// Exemple d'utilisation
testHtml = '<div class="fc-event-time">10:30 - 11:30</div>';
console.log(extractEventFromHtml(testHtml));
