# Enrichissement Décideurs

One-pager B2B : SIREN ➔ contacts décideurs (via webhook Make / Societeinfo).

Stack : Next.js (App Router) · React 19 · Tailwind CSS v4 · lucide-react.
Toute la logique UI est dans [`src/app/page.tsx`](src/app/page.tsx) (fichier unique, volontairement).

## Design system

Style « Linear / Modern » (dark, lumière ambiante, profondeur). Les tokens sont
centralisés dans [`src/app/globals.css`](src/app/globals.css) via `@theme`
(couleurs, ombres multi-couches, easing expo-out, keyframes) et exposés en
utilitaires Tailwind : `bg-surface`, `text-fg-muted`, `shadow-card`, `ease-expo`…
Les motifs trop verbeux (fond ambiant, bruit, grille, spotlight, texte dégradé,
shine des CTA) sont des `@utility` nommés.

Responsive : typographie fluide (`clamp`), grille `auto-fill` (1 → 3 colonnes
selon la largeur, testée de 320 px à 1440 px), safe-areas iOS, `prefers-reduced-motion`
respecté, hover uniquement sur pointeur fin.

Compatibilité : Tailwind v4 cible les navigateurs modernes — Chrome/Edge 111+,
Safari 16.4+, Firefox 128+ (voir la doc Tailwind). Pas de support IE ni des
versions antérieures.

## Démarrage

```bash
npm install
npm run dev
```

## Configuration du webhook Make

Le navigateur appelle uniquement `/api/enrich` (`src/app/api/enrich/route.ts`),
une route serveur qui valide la requête puis la relaie au webhook Make. L'URL du
webhook est lue depuis `MAKE_WEBHOOK_URL` (voir `.env.example`), **sans** préfixe
`NEXT_PUBLIC_` : elle n'est jamais exposée côté client, et le CORS n'entre pas en jeu.

- **Local** : renseignez `MAKE_WEBHOOK_URL` dans `.env.local`.
- **Vercel** : même variable dans les variables d'environnement du projet.
- **Vérification des intitulés** (optionnelle) : avec `SOCIETEINFO_API_KEY`, la
  route relit la liste complète de l'entreprise en mode anonymisé (0 crédit) et
  écarte les contacts dont Societeinfo a mal recopié l'intitulé (ex. un dirigeant
  renvoyé avec le poste d'une chargée de marketing). Sans la variable, les
  contacts sont renvoyés tels quels.
- **CSV** : généré par la route à partir du JSON de Make (Make est toujours
  appelé en `format: "ui"`), pour bénéficier de la même vérification.
- **Test sans Make** : `MAKE_WEBHOOK_URL=http://localhost:3000/api/mock-make`
  utilise une route de démo (`src/app/api/mock-make/route.ts`) qui simule la
  latence (2,5 s) et renvoie 4 contacts fictifs.
  - `000000000` ➔ tableau vide (empty state)
  - `500000000` ➔ erreur HTTP 500 (bannière d'erreur)
  - tout autre SIREN ➔ 4 contacts (UI) ou un CSV (mode CSV)

## Contrat d'API

`POST /api/enrich` (relayé tel quel vers le webhook Make) · `Content-Type: application/json`

```json
{ "siren": "123456789", "format": "ui" }
```

- `format: "ui"` ➔ JSON : `[{ firstName, lastName, role, email, linkedin_url, email_test_result }]`
- `format: "csv"` ➔ `text/csv`, téléchargé sous `contacts_{SIREN}.csv`
