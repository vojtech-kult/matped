const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Vypne Markdown v údajích zadaných studentem nebo lektorem (jména, názvy)
export const escapeMd = (text) => String(text).replace(/([\\*_~`|>[\]()#-])/g, '\\$1');
export { clip };

const TYPE_INFO = {
  poptavka: { title: 'Nová poptávka doučování', color: 0x16a34a },
  dotaz: { title: 'Nový dotaz', color: 0x2563eb },
  hodnoceni: { title: 'Nové hodnocení', color: 0xf59e0b },
  contact: { title: 'Nový kontakt z webu', color: 0x5865f2 }, // starší záznamy
};

const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

function buildPayload(lead) {
  const info = TYPE_INFO[lead.type] ?? TYPE_INFO.contact;

  const fields = [];
  if (lead.rating) fields.push({ name: 'Hodnocení', value: `${stars(lead.rating)} (${lead.rating}/5)` });
  if (lead.name) fields.push({ name: 'Jméno', value: clip(lead.name, 1024), inline: true });
  if (lead.email) fields.push({ name: 'E-mail', value: clip(lead.email, 1024), inline: true });
  if (lead.phone) fields.push({ name: 'Telefon', value: clip(lead.phone, 1024), inline: true });

  return {
    username: 'MatPed forms',
    // Zakáže jakékoli pingování (@everyone, @here, role), i kdyby ho návštěvník napsal do formuláře
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: info.title,
        color: info.color,
        // Limity Discordu: description 4096, hodnota pole 1024 znaků
        description: lead.message ? clip(lead.message, 3500) : '*Bez zprávy*',
        fields,
        footer: { text: `Formulář: ${lead.type} • ID: ${lead.id}` },
        timestamp: lead.createdAt.toISOString(),
      },
    ],
  };
}

// Společné odeslání na webhook (s jedním opakováním při limitu Discordu). Při chybě vyhodí výjimku.
async function postWebhook(payload) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) throw new Error('DISCORD_WEBHOOK_URL není nastaven');

  // výchozí jméno a zákaz pingů; hotový payload je může přepsat
  const body = JSON.stringify({ username: 'MatPed forms', allowed_mentions: { parse: [] }, ...payload });

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) return;

    // Discord omezuje počet zpráv; při 429 řekne, jak dlouho počkat (v sekundách)
    if (res.status === 429 && attempt === 1) {
      const data = await res.json().catch(() => ({}));
      await sleep(Math.min((data.retry_after ?? 1) * 1000, 5000));
      continue;
    }

    throw new Error(`Discord odpověděl stavem ${res.status}`);
  }
}

export async function sendLeadToDiscord(lead) {
  await postWebhook(buildPayload(lead));
}

// Vlastní zpráva (embed) mimo formuláře z webu, např. dotazy studentů k videím
export const sendDiscordPayload = postWebhook;