import { NextResponse } from "next/server";

// Proxy serveur vers le webhook Make : l'URL reste côté serveur (variable sans
// préfixe NEXT_PUBLIC_), le navigateur ne voit que /api/enrich.
const WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

const SIREN_REGEX = /^\d{9}$/;

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

  let upstream: Response;
  try {
    upstream = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siren, format }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Webhook Make injoignable." }, { status: 502 });
  }

  // Relaie tel quel le statut, le type de contenu et le corps (JSON ou CSV).
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
