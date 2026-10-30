import { NextResponse } from "next/server";

// Proxy serveur vers le webhook Make : l'URL reste côté serveur (variable sans
// préfixe NEXT_PUBLIC_), le navigateur ne voit que /api/enrich.
const WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
// Clé Societeinfo, utilisée uniquement pour la vérification gratuite des intitulés.
const SOCIETEINFO_API_KEY = process.env.SOCIETEINFO_API_KEY;

const SIREN_REGEX = /^\d{9}$/;

// Mêmes colonnes, dans le même ordre, que l'ancien export CSV généré par Make.
const CSV_COLUMNS = [
  "role",
  "email",
  "civility",
  "lastName",
  "firstName",
  "level_code",
  "domain_code",
  "email_score",
  "level_label",
  "domain_label",
  "linkedin_url",
  "email_test_result",
] as const;

type Contact = Record<string, unknown> & { id?: unknown; role?: unknown };

// Make peut mettre 10-15 s (scraping temps réel) : marge pour Vercel.
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!WEBHOOK_URL) {
    return NextResponse.json(
      { error: "MAKE_WEBHOOK_URL non configurée côté serveur." },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  // On ne relaie que des requêtes valides, pour ne pas consommer de crédits pour rien.
  const { siren, format } = (body ?? {}) as { siren?: unknown; format?: unknown };
  if (typeof siren !== "string" || !SIREN_REGEX.test(siren)) {
    return NextResponse.json({ error: "SIREN invalide." }, { status: 400 });
  }
  if (format !== "ui" && format !== "csv") {
    return NextResponse.json({ error: "Format invalide." }, { status: 400 });
  }

  // On demande toujours le JSON à Make : le CSV est construit ici, après
  // vérification, pour que l'export bénéficie du même filtrage que l'écran.
  let upstream: Response;
  try {
    upstream = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siren, format: "ui" }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Webhook Make injoignable." }, { status: 502 });
  }

  if (!upstream.ok) {
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "text/plain",
        "Cache-Control": "no-store",
      },
    });
  }

  let contacts: Contact[];
  try {
    const text = await upstream.text();
    contacts = text.trim() ? normalizeContacts(JSON.parse(text)) : [];
  } catch {
    return NextResponse.json(
      { error: "Réponse inattendue du webhook Make (JSON invalide)." },
      { status: 502 },
    );
  }

  contacts = await dropMislabeledContacts(siren, contacts);

  if (format === "csv") {
    return new NextResponse(toCsv(contacts), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="contacts_${siren}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return NextResponse.json(contacts, { headers: { "Cache-Control": "no-store" } });
}

/** Make peut renvoyer un tableau brut ou un objet enveloppant le tableau. */
function normalizeContacts(payload: unknown): Contact[] {
  if (Array.isArray(payload)) return payload as Contact[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["contacts", "data", "results", "decideurs"]) {
      if (Array.isArray(obj[key])) return obj[key] as Contact[];
    }
  }
  return [];
}

/**
 * Societeinfo attribue parfois, dans une recherche filtrée par intitulé, le poste
 * d'une autre personne à un contact (ex. le dirigeant de Locabri renvoyé comme
 * « Chargée de marketing et communication »). On relit la liste complète de
 * l'entreprise en mode anonymisé (0 crédit, intitulés et identifiants intacts)
 * et on écarte les contacts dont le vrai intitulé diffère.
 *
 * En cas d'échec de la vérification, on renvoie les contacts tels quels : mieux
 * vaut un résultat non vérifié qu'une recherche (déjà payée) perdue.
 */
async function dropMislabeledContacts(siren: string, contacts: Contact[]) {
  if (!SOCIETEINFO_API_KEY || contacts.length === 0) return contacts;

  const url = new URL(`https://societeinfo.com/app/rest/api/v2/contacts.json/${siren}`);
  url.searchParams.set("key", SOCIETEINFO_API_KEY);
  url.searchParams.set("show_all_anonymized", "true");
  url.searchParams.set("contact_max", "1000");

  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reference = normalizeContacts(await response.json());
    const trueRoles = new Map(reference.map((c) => [String(c.id), c.role]));

    return contacts.filter((contact) => {
      const id = String(contact.id);
      // Contact absent de la référence (liste tronquée…) : on ne peut pas trancher, on garde.
      if (!trueRoles.has(id)) return true;
      return trueRoles.get(id) === contact.role;
    });
  } catch (err) {
    console.warn(`[enrich] Vérification des intitulés impossible pour ${siren} :`, err);
    return contacts;
  }
}

function toCsv(contacts: Contact[]) {
  const escape = (value: unknown) =>
    `"${(value === null || value === undefined ? "" : String(value)).replace(/"/g, '""')}"`;
  const rows = contacts.map((c) => CSV_COLUMNS.map((col) => escape(c[col])).join(","));
  return [CSV_COLUMNS.map(escape).join(","), ...rows].join("\n");
}
