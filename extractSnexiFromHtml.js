
// Extraction d'événements depuis une page HTML de calendrier Snexi (offline)
const fs = require('fs');
const cheerio = require('cheerio');

function extractSnexiEventsFromHtml(html) {
  const $ = cheerio.load(html);
  const events = [];
  // Cible les événements du calendrier
  $('.fc-event.fc-event-vert.fc-event-start.fc-event-end').each((i, el) => {
    const time = $(el).find('.fc-event-time').text().trim();
    const title = $(el).find('.fc-event-title').text().trim();
    const style = $(el).attr('style') || '';
    // Détection du type par couleur
    let type = 'autre';
    if (style.includes('207, 36, 36')) type = 'Indisponibilité';
    else if (style.includes('18, 17, 171')) type = 'EDL entrée';
    else if (style.includes('17, 138, 123')) type = 'EDL sortie';
    // Extraction des horaires
    let start = null, end = null;
    if (/\d{2}:\d{2} - \d{2}:\d{2}/.test(time)) {
      [start, end] = time.split(' - ');
    }
    // Extraction de l'adresse si présente dans un attribut data-address ou dans le contenu
    let address = '';
    if ($(el).attr('data-address')) {
      address = $(el).attr('data-address').trim();
    } else {
      // Cherche une adresse dans le texte du titre ou d'un sous-élément
      const textContent = $(el).text();
      const addressMatch = textContent.match(/\d{1,3} ?[a-zA-ZéèàçÉÈÀÇ\- ]+,? ?\d{5} ?[a-zA-ZéèàçÉÈÀÇ\- ]+/);
      if (addressMatch) {
        address = addressMatch[0].trim();
      }
    }
    events.push({
      time,
      start,
      end,
      title,
      type,
      style,
      address
    });
  });
  return events;
}

// Exemple d'utilisation offline
if (require.main === module) {
  const html = fs.readFileSync('debug/snexi-calendar.html', 'utf-8');
  const events = extractSnexiEventsFromHtml(html);
  console.log('Événements extraits :', events.length);
  console.log(events);
}

module.exports = { extractSnexiEventsFromHtml };
