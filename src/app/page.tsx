"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  Loader2,
  Mail,
  Monitor,
  Search,
  Users,
  X,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Config & types                                                            */
/* -------------------------------------------------------------------------- */

const WEBHOOK_URL =
  process.env.NEXT_PUBLIC_MAKE_WEBHOOK_URL ?? "REMPLACER_PAR_URL_WEBHOOK_MAKE";

const SIREN_REGEX = /^\d{9}$/;

type OutputFormat = "ui" | "csv";

type Contact = {
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  email_test_result?: string | null;
};

type SearchState =
  | { status: "idle" }
  | { status: "loading"; format: OutputFormat }
  | { status: "success"; siren: string; contacts: Contact[] }
  | { status: "downloaded"; siren: string };

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

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

type EmailQuality = { label: string; dot: string; text: string };

function getEmailQuality(result?: string | null): EmailQuality {
  const value = (result ?? "").toLowerCase();
  if (value.includes("safe")) {
    return { label: "Safe to Send", dot: "bg-success", text: "text-success" };
  }
  if (value.includes("risky") || value.includes("catch") || value.includes("unknown")) {
    return { label: result || "À vérifier", dot: "bg-yellow", text: "text-warning" };
  }
  if (value.includes("invalid") || value.includes("undeliverable") || value.includes("bounce")) {
    return { label: result || "Invalide", dot: "bg-danger", text: "text-danger" };
  }
  return { label: result || "Non testé", dot: "bg-fg-muted/50", text: "text-fg-muted" };
}

function initials(first?: string | null, last?: string | null) {
  const f = (first ?? "").trim().charAt(0);
  const l = (last ?? "").trim().charAt(0);
  return (f + l).toUpperCase() || "?";
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function Page() {
  const [siren, setSiren] = useState("");
  const [format, setFormat] = useState<OutputFormat>("ui");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  // Verrou synchrone contre le multi-clic (le state React est asynchrone).
  const inFlightRef = useRef(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heroRef = useRef<HTMLElement>(null);

  const isSirenValid = SIREN_REGEX.test(siren);
  const isLoading = search.status === "loading";
  const canSubmit = isSirenValid && !isLoading;

  /* ------------------------- Parallax léger du hero ------------------------ */
  // Piloté hors React (style direct) pour rester à 60 fps ; désactivé si
  // l'utilisateur préfère moins de mouvement.
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const progress = Math.min(window.scrollY / 400, 1);
      hero.style.opacity = String(1 - progress * 0.6);
      hero.style.transform = `translateY(${progress * 40}px) scale(${1 - progress * 0.03})`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  /* ----------------------------- Input handling ---------------------------- */

  function handleSirenChange(value: string) {
    // N'accepte que les chiffres, tronqué à 9 caractères.
    setSiren(value.replace(/\D/g, "").slice(0, 9));
  }

  const inputTone =
    siren.length === 0
      ? "border-blue-200 focus:border-blue focus:shadow-[0_0_0_3px_var(--color-blue-100)]"
      : isSirenValid
        ? "border-success/50 focus:border-success focus:shadow-[0_0_0_3px_rgba(21,128,61,0.15)]"
        : "border-danger/50 focus:border-danger focus:shadow-[0_0_0_3px_var(--color-orange-50)]";

  /* ------------------------------ Submission ------------------------------- */

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || inFlightRef.current) return;

    if (!WEBHOOK_URL || WEBHOOK_URL.startsWith("REMPLACER")) {
      setError(
        "URL du webhook Make non configurée. Renseignez NEXT_PUBLIC_MAKE_WEBHOOK_URL dans .env.local.",
      );
      return;
    }

    inFlightRef.current = true;
    setError(null);
    setSearch({ status: "loading", format });

    try {
      // Pas d'AbortController / timeout : Make peut mettre 10-15 s (scraping temps réel).
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siren, format }),
      });

      if (!response.ok) {
        throw new Error(
          `Le serveur a répondu ${response.status}${
            response.statusText ? ` (${response.statusText})` : ""
          }.`,
        );
      }

      if (format === "csv") {
        const blob = await response.blob();
        triggerDownload(blob, `contacts_${siren}.csv`);
        setSearch({ status: "downloaded", siren });
        return;
      }

      const text = await response.text();
      let payload: unknown = [];
      if (text.trim().length > 0) {
        try {
          payload = JSON.parse(text);
        } catch {
          throw new Error("Réponse inattendue du serveur (JSON invalide).");
        }
      }
      setSearch({ status: "success", siren, contacts: normalizeContacts(payload) });
    } catch (err) {
      const message =
        err instanceof TypeError
          ? "Impossible de joindre l'API. Vérifiez votre connexion ou la configuration CORS du webhook."
          : err instanceof Error
            ? err.message
            : "Une erreur inconnue est survenue.";
      setError(message);
      setSearch({ status: "idle" });
    } finally {
      inFlightRef.current = false;
    }
  }

  /** Force le téléchargement natif du Blob via un <a> invisible. */
  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Laisse le temps au navigateur d'initier le téléchargement avant de libérer l'URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ------------------------------ Copy email ------------------------------- */

  async function copyEmail(email: string) {
    try {
      await writeToClipboard(email);
      setCopiedEmail(email);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedEmail(null), 2000);
    } catch {
      setError("Impossible de copier l'email dans le presse-papiers.");
    }
  }

  /** Clipboard API en priorité, fallback execCommand (contextes non sécurisés / permissions refusées). */
  async function writeToClipboard(text: string) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // on tente le fallback ci-dessous
      }
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!ok) throw new Error("execCommand copy failed");
  }

  /* -------------------------------- Render --------------------------------- */

  return (
    <main className="relative isolate flex-1 overflow-x-clip">
      <AmbientBackground />

      {/* ---------------------------- Error banner --------------------------- */}
      {error && (
        <div
          role="alert"
          className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-[max(1rem,env(safe-area-inset-top))]"
        >
          <div className="flex w-full max-w-2xl animate-fade-up items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-fg-body shadow-card">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-fg">La requête a échoué</p>
              <p className="mt-0.5 break-words text-fg-muted">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Fermer l'alerte"
              className="rounded-md p-1 text-fg-muted transition duration-200 hover:bg-blue-50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-5xl px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-14 sm:px-6 sm:pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pt-20 lg:px-8 lg:pt-28">
        {/* ------------------------------ Header ------------------------------ */}
        <header
          ref={heroRef}
          className="mx-auto max-w-2xl text-center will-change-transform"
        >
          <span className="inline-flex animate-fade-up items-center gap-2 rounded-full bg-blue-50 px-3.5 py-1 text-xs font-medium text-blue-700">
            <span className="h-1.5 w-1.5 rounded-full bg-orange" />
            Societeinfo × Make
          </span>
          <h1
            className="mt-5 animate-fade-up text-balance text-[clamp(2.25rem,3vw+1.25rem,4rem)] font-semibold leading-[1.15] text-navy [animation-delay:80ms]"
          >
            Enrichissement <span className="text-orange">Décideurs</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl animate-fade-up text-pretty text-[clamp(0.95rem,0.5vw+0.8rem,1.125rem)] leading-relaxed text-fg-muted [animation-delay:160ms]">
            Saisissez un SIREN pour obtenir instantanément les contacts
            décideurs d&apos;une entreprise : nom, rôle, email vérifié et profil
            LinkedIn.
          </p>
        </header>

        {/* ------------------------------ Form card --------------------------- */}
        <form
          onSubmit={handleSubmit}
          className="relative mx-auto mt-10 max-w-2xl animate-scale-in rounded-xl border border-border bg-surface p-5 shadow-card [animation-delay:240ms] sm:mt-12 sm:p-8"
        >
          <div className="relative">
            <label
              htmlFor="siren"
              className="block text-sm font-medium text-fg"
            >
              Numéro SIREN
            </label>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-blue" />
              <input
                id="siren"
                name="siren"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="123 456 789"
                value={siren}
                onChange={(e) => handleSirenChange(e.target.value)}
                disabled={isLoading}
                aria-invalid={siren.length > 0 && !isSirenValid}
                className={`w-full min-w-0 rounded-lg border bg-bg-input py-3.5 pl-12 pr-16 text-[clamp(1rem,0.4vw+0.9rem,1.125rem)] font-medium tabular-nums tracking-[0.18em] text-fg transition duration-200 ease-expo placeholder:font-normal placeholder:tracking-[0.18em] placeholder:text-fg-muted/50 focus:outline-none disabled:bg-bg-soft disabled:opacity-70 ${inputTone}`}
              />
              <span
                className={`pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium tabular-nums transition-colors duration-200 ${
                  siren.length === 0
                    ? "text-fg-muted"
                    : isSirenValid
                      ? "text-success"
                      : "text-danger"
                }`}
              >
                {siren.length}/9
              </span>
            </div>
            <p
              className={`mt-2 min-h-[1.25rem] text-xs transition-colors duration-200 ${
                siren.length > 0 && !isSirenValid ? "text-danger" : "text-fg-muted"
              }`}
            >
              {siren.length > 0 && !isSirenValid
                ? "Le SIREN doit contenir exactement 9 chiffres."
                : "9 chiffres, sans espaces."}
            </p>

            {/* Toggle format */}
            <fieldset className="mt-6">
              <legend className="text-sm font-medium text-fg">
                Format de sortie
              </legend>
              <div
                role="radiogroup"
                className="mt-2 grid grid-cols-1 gap-1 rounded-lg bg-blue-50 p-1 min-[360px]:grid-cols-2"
              >
                <FormatOption
                  active={format === "ui"}
                  disabled={isLoading}
                  onClick={() => setFormat("ui")}
                  icon={<Monitor className="h-4 w-4" />}
                  label="Afficher à l'écran"
                />
                <FormatOption
                  active={format === "csv"}
                  disabled={isLoading}
                  onClick={() => setFormat("csv")}
                  icon={<Download className="h-4 w-4" />}
                  label="Télécharger CSV"
                />
              </div>
            </fieldset>

            <button
              type="submit"
              disabled={!canSubmit}
              className="btn-invox mt-8 inline-flex w-[calc(100%-5px)] items-center justify-center gap-2 px-5 py-3.5 text-[0.95rem] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Recherche...
                </>
              ) : format === "csv" ? (
                <>
                  <Download className="h-4 w-4" />
                  Télécharger les décideurs
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  Rechercher les décideurs
                </>
              )}
            </button>
            <p
              className={`mt-4 text-center text-xs transition-colors duration-300 ${
                isLoading ? "animate-pulse-soft text-blue-700" : "text-fg-muted"
              }`}
            >
              Extraction en temps réel — comptez 10 à 15 secondes.
            </p>
          </div>
        </form>

        {/* ------------------------------ Results ----------------------------- */}
        <section className="mt-12 sm:mt-16" aria-live="polite">
          {search.status === "loading" && search.format === "ui" && (
            <ResultsGrid>
              {[0, 1, 2].map((i) => (
                <SkeletonCard key={i} />
              ))}
            </ResultsGrid>
          )}

          {search.status === "downloaded" && (
            <div className="mx-auto flex max-w-2xl animate-fade-up items-center gap-3 rounded-xl border border-success/25 bg-success/[0.06] px-4 py-3 text-sm text-fg">
              <Check className="h-5 w-5 shrink-0 text-success" />
              <p className="min-w-0 break-words">
                Le fichier{" "}
                <span className="font-semibold">
                  contacts_{search.siren}.csv
                </span>{" "}
                a été téléchargé.
              </p>
            </div>
          )}

          {search.status === "success" && search.contacts.length === 0 && (
            <EmptyState siren={search.siren} />
          )}

          {search.status === "success" && search.contacts.length > 0 && (
            <>
              <div className="mb-5 animate-fade-up">
                <p className="text-sm font-medium text-orange-600">
                  Résultats
                </p>
                <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="text-2xl font-semibold text-navy sm:text-[1.75rem]">
                    Décideurs identifiés
                  </h2>
                  <p className="text-sm tabular-nums text-fg-muted">
                    SIREN <span className="font-medium text-fg">{search.siren}</span>{" "}
                    · {search.contacts.length} contact
                    {search.contacts.length > 1 ? "s" : ""}
                  </p>
                </div>
              </div>
              <ResultsGrid>
                {search.contacts.map((contact, index) => (
                  <ContactCard
                    key={`${contact.email ?? ""}-${contact.lastName ?? ""}-${index}`}
                    contact={contact}
                    index={index}
                    copied={!!contact.email && copiedEmail === contact.email}
                    onCopy={copyEmail}
                  />
                ))}
              </ResultsGrid>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sous-composants (même fichier, volontairement)                            */
/* -------------------------------------------------------------------------- */

/** Fond : bandeau bleu clair en haut (coin arrondi façon invox.fr) + quelques
 *  formes de marque flottantes, discrètes. */
function AmbientBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[min(620px,90vh)] overflow-hidden"
    >
      <div className="absolute inset-0 rounded-br-[clamp(48px,10vw,120px)] bg-blue-50" />
      {/* Formes réservées aux grands écrans : elles flanquent le titre sans le chevaucher. */}
      <div className="absolute left-[7%] top-[20%] hidden h-16 w-16 animate-float rounded-full border-2 border-dashed border-blue-200 lg:block" />
      <div className="absolute right-[9%] top-[12%] h-3.5 w-3.5 animate-float rounded-full bg-orange [animation-delay:-3s]" />
      <div className="absolute right-[13%] top-[44%] hidden h-5 w-5 animate-float rounded-[5px] bg-yellow [animation-delay:-6s] lg:block" />
    </div>
  );
}

/** Grille fluide : 1 colonne dès 320 px, puis autant de colonnes que la largeur le permet. */
function ResultsGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4 sm:gap-5">
      {children}
    </div>
  );
}

function FormatOption({
  active,
  disabled,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-2 text-xs font-medium transition duration-200 ease-expo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue disabled:cursor-not-allowed sm:gap-2 sm:px-3 sm:text-sm ${
        active
          ? "border-blue bg-white text-navy shadow-offset-sm"
          : "border-transparent text-fg-muted hover:bg-white/70 hover:text-fg"
      }`}
    >
      <span className="hidden min-[420px]:contents">{icon}</span>
      {label}
    </button>
  );
}

function ContactCard({
  contact,
  index,
  copied,
  onCopy,
}: {
  contact: Contact;
  index: number;
  copied: boolean;
  onCopy: (email: string) => void;
}) {
  const fullName =
    [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
    "Nom inconnu";
  const quality = getEmailQuality(contact.email_test_result);

  return (
    <article
      style={{ animationDelay: `${index * 80}ms` }}
      className="relative flex animate-fade-up flex-col rounded-xl border border-border bg-surface p-5 shadow-card transition duration-300 ease-expo hover:-translate-x-[3px] hover:-translate-y-[3px] hover:border-blue hover:shadow-offset"
    >
      <div className="relative flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 font-display text-base font-semibold text-blue-700">
          {initials(contact.firstName, contact.lastName)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold leading-snug text-navy">
            {fullName}
          </h3>
          {contact.role && (
            <span className="mt-1 inline-block max-w-full truncate rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-600">
              {contact.role}
            </span>
          )}
        </div>
        {contact.linkedin_url && (
          <a
            href={contact.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Profil LinkedIn de ${fullName}`}
            className="shrink-0 rounded-lg p-2 text-blue transition duration-200 ease-expo hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
          >
            <LinkedinIcon className="h-[18px] w-[18px]" />
          </a>
        )}
      </div>

      <div className="relative mt-4 border-t border-blue-100 pt-4">
        {contact.email ? (
          <>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 shrink-0 text-blue" />
              <a
                href={`mailto:${contact.email}`}
                className="min-w-0 flex-1 truncate text-sm text-ink underline-offset-4 transition-colors duration-200 hover:text-blue-700 hover:underline"
              >
                {contact.email}
              </a>
              <button
                type="button"
                onClick={() => onCopy(contact.email!)}
                aria-label={copied ? "Email copié" : "Copier l'email"}
                className={`inline-flex min-w-[4.5rem] shrink-0 items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition duration-200 ease-expo active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue ${
                  copied
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-blue-200 bg-white text-navy hover:border-blue hover:bg-blue-50"
                }`}
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Copié
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copier
                  </>
                )}
              </button>
            </div>
            <div className={`mt-2.5 flex items-center gap-2 text-xs font-medium ${quality.text}`}>
              <span className={`h-2 w-2 rounded-full ${quality.dot}`} />
              {quality.label}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Mail className="h-4 w-4 shrink-0" />
            Aucun email trouvé
          </div>
        )}
      </div>
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="relative animate-pulse rounded-xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 shrink-0 rounded-full bg-blue-50" />
        <div className="min-w-0 flex-1">
          <div className="my-1 h-4 w-2/3 rounded bg-blue-100" />
          <div className="mt-1.5 h-[22px] w-1/3 rounded-full bg-blue-50" />
        </div>
        <div className="h-[34px] w-[34px] shrink-0 rounded-lg bg-blue-50" />
      </div>
      <div className="mt-4 border-t border-blue-100 pt-4">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 shrink-0 rounded bg-blue-50" />
          <div className="h-4 flex-1 rounded bg-blue-100" />
          <div className="h-[26px] w-[4.5rem] shrink-0 rounded-md bg-blue-50" />
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-blue-100" />
          <div className="h-3 w-1/4 rounded bg-blue-50" />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ siren }: { siren: string }) {
  return (
    <div className="relative mx-auto flex max-w-md animate-scale-in flex-col items-center rounded-xl border-2 border-dashed border-blue-200 bg-white px-6 py-12 text-center">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-orange-50">
        <Users className="h-6 w-6 text-orange" />
      </div>
      <h2 className="relative mt-4 text-xl font-semibold text-navy">
        Aucun décideur trouvé pour ce SIREN
      </h2>
      <p className="relative mt-1.5 text-sm text-fg-muted">
        Aucun contact n&apos;a pu être identifié pour{" "}
        <span className="font-medium text-fg">{siren}</span>. Vérifiez le
        numéro ou essayez une autre entreprise.
      </p>
    </div>
  );
}

/** Icône LinkedIn inline (les icônes de marques ont été retirées de lucide-react). */
function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}
