"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
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
  Sparkles,
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
    return {
      label: "Safe to Send",
      dot: "bg-success shadow-[0_0_8px_rgba(74,222,128,0.6)]",
      text: "text-success",
    };
  }
  if (value.includes("risky") || value.includes("catch") || value.includes("unknown")) {
    return { label: result || "À vérifier", dot: "bg-warning", text: "text-warning" };
  }
  if (value.includes("invalid") || value.includes("undeliverable") || value.includes("bounce")) {
    return { label: result || "Invalide", dot: "bg-danger", text: "text-danger" };
  }
  return { label: result || "Non testé", dot: "bg-fg-muted/60", text: "text-fg-muted" };
}

function initials(first?: string | null, last?: string | null) {
  const f = (first ?? "").trim().charAt(0);
  const l = (last ?? "").trim().charAt(0);
  return (f + l).toUpperCase() || "?";
}

/** Spotlight : positionne le halo radial sous le curseur via des variables CSS. */
function trackSpotlight(e: MouseEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--spot-x", `${e.clientX - rect.left}px`);
  e.currentTarget.style.setProperty("--spot-y", `${e.clientY - rect.top}px`);
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
      ? "border-white/10 focus:border-accent focus:shadow-[0_0_0_3px_rgba(94,106,210,0.25)]"
      : isSirenValid
        ? "border-success/60 focus:border-success focus:shadow-[0_0_0_3px_rgba(74,222,128,0.2)]"
        : "border-danger/60 focus:border-danger focus:shadow-[0_0_0_3px_rgba(248,113,113,0.2)]";

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
    <main className="relative flex-1 overflow-x-clip">
      <AmbientBackground />

      {/* ---------------------------- Error banner --------------------------- */}
      {error && (
        <div
          role="alert"
          className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-[max(1rem,env(safe-area-inset-top))]"
        >
          <div className="flex w-full max-w-2xl animate-fade-up items-start gap-3 rounded-xl border border-danger/30 bg-[#1a0c0e]/90 px-4 py-3 text-sm text-fg shadow-[0_0_0_1px_rgba(248,113,113,0.15),0_8px_40px_rgba(0,0,0,0.6),0_0_60px_rgba(248,113,113,0.12)] backdrop-blur-xl">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">La requête a échoué</p>
              <p className="mt-0.5 break-words text-fg-muted">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Fermer l'alerte"
              className="rounded-md p-1 text-fg-muted transition duration-200 hover:bg-white/[0.06] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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
          <span className="inline-flex animate-fade-up items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-fg-subtle shadow-inset-highlight">
            <Sparkles className="h-3 w-3 text-accent-bright" />
            Societeinfo × Make
          </span>
          <h1
            className="mt-5 animate-fade-up text-balance text-[clamp(2.125rem,3vw+1.25rem,4rem)] font-semibold leading-[1.05] tracking-[-0.03em] [animation-delay:80ms]"
          >
            <span className="text-gradient-fg">Enrichissement</span>{" "}
            <span className="text-gradient-accent animate-shimmer">Décideurs</span>
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
          onMouseMove={trackSpotlight}
          className="group/form relative mx-auto mt-10 max-w-2xl animate-scale-in overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-card [animation-delay:240ms] sm:mt-12 sm:p-7"
        >
          {/* Liseré lumineux en haut + spotlight curseur */}
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          <span className="pointer-events-none absolute inset-0 bg-spotlight opacity-0 transition-opacity duration-300 group-hover/form:opacity-100" />

          <div className="relative">
            <label
              htmlFor="siren"
              className="block font-mono text-[11px] uppercase tracking-widest text-fg-muted"
            >
              Numéro SIREN
            </label>
            <div className="relative mt-2.5">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-fg-muted" />
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
                className={`w-full min-w-0 rounded-lg border bg-bg-input py-3.5 pl-12 pr-16 font-mono text-[clamp(1rem,0.4vw+0.9rem,1.125rem)] tracking-[0.18em] text-fg shadow-input transition duration-200 ease-expo placeholder:tracking-[0.18em] placeholder:text-fg-muted/50 focus:outline-none disabled:opacity-60 ${inputTone}`}
              />
              <span
                className={`pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs tabular-nums transition-colors duration-200 ${
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
              <legend className="font-mono text-[11px] uppercase tracking-widest text-fg-muted">
                Format de sortie
              </legend>
              <div
                role="radiogroup"
                className="mt-2.5 grid grid-cols-1 gap-1 rounded-lg border border-border bg-black/40 p-1 shadow-inset-highlight min-[360px]:grid-cols-2"
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
              className="btn-shine mt-7 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3.5 text-sm font-semibold text-white shadow-cta transition duration-200 ease-expo hover:bg-accent-bright hover:shadow-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-fg-muted disabled:shadow-inset-highlight"
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
              className={`mt-3 text-center text-xs transition-colors duration-300 ${
                isLoading ? "animate-pulse-glow text-fg-subtle" : "text-fg-muted/80"
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
            <div className="mx-auto flex max-w-2xl animate-fade-up items-center gap-3 rounded-xl border border-success/20 bg-success/[0.06] px-4 py-3 text-sm text-fg shadow-[0_0_0_1px_rgba(74,222,128,0.08),0_2px_20px_rgba(0,0,0,0.4)]">
              <Check className="h-5 w-5 shrink-0 text-success" />
              <p className="min-w-0 break-words">
                Le fichier{" "}
                <span className="font-mono font-semibold">
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
                <p className="font-mono text-[11px] uppercase tracking-widest text-fg-muted">
                  Résultats
                </p>
                <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
                    Décideurs identifiés
                  </h2>
                  <p className="text-sm tabular-nums text-fg-muted">
                    SIREN <span className="font-mono text-fg">{search.siren}</span>{" "}
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

/** Fond ambiant : gradient de base + blobs flottants + bruit + grille. */
function AmbientBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ambient-base"
    >
      {/* Blob principal — haut centre */}
      <div className="absolute left-1/2 top-[-30%] h-[min(1400px,140vh)] w-[min(900px,120vw)] -translate-x-1/2 transform-gpu animate-float rounded-full bg-accent/25 blur-[90px] sm:blur-[150px]" />
      {/* Blob secondaire — gauche, violet/rose */}
      <div className="absolute left-[-20%] top-[20%] h-[min(800px,90vh)] w-[min(600px,80vw)] transform-gpu animate-float-slow rounded-full bg-gradient-to-br from-purple-500/15 to-pink-500/10 blur-[70px] sm:blur-[120px]" />
      {/* Blob tertiaire — droite, indigo/bleu */}
      <div className="absolute right-[-15%] top-[35%] h-[min(700px,80vh)] w-[min(500px,70vw)] transform-gpu animate-float rounded-full bg-gradient-to-bl from-indigo-500/12 to-blue-500/10 blur-[60px] [animation-delay:-4s] sm:blur-[100px]" />
      {/* Accent bas — pulsation lente */}
      <div className="absolute bottom-[-20%] left-1/2 h-[min(500px,60vh)] w-[min(800px,110vw)] -translate-x-1/2 transform-gpu animate-pulse-glow rounded-full bg-accent/10 blur-[70px] sm:blur-[120px]" />
      {/* Bruit + grille */}
      <div className="absolute inset-0 bg-noise opacity-[0.015]" />
      <div className="absolute inset-0 bg-grid-64 opacity-[0.02]" />
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
      className={`inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-2 text-xs font-medium transition duration-200 ease-expo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed sm:gap-2 sm:px-3 sm:text-sm ${
        active
          ? "bg-white/[0.08] text-fg shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.1)]"
          : "text-fg-muted hover:bg-white/[0.04] hover:text-fg"
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
      onMouseMove={trackSpotlight}
      style={{ animationDelay: `${index * 80}ms` }}
      className="group relative flex animate-fade-up flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-card transition duration-300 ease-expo hover:-translate-y-1 hover:border-border-hover hover:shadow-card-hover"
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      <span className="pointer-events-none absolute inset-0 bg-spotlight opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      <div className="relative flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.1] to-white/[0.02] font-mono text-sm font-semibold text-fg shadow-inset-highlight">
          {initials(contact.firstName, contact.lastName)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold tracking-tight text-fg">
            {fullName}
          </h3>
          {contact.role && (
            <span className="mt-1.5 inline-block max-w-full truncate rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-0.5 text-xs text-fg-muted">
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
            className="shrink-0 rounded-lg border border-transparent p-2 text-fg-muted transition duration-200 ease-expo hover:border-accent/30 hover:bg-accent/10 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <LinkedinIcon className="h-[18px] w-[18px]" />
          </a>
        )}
      </div>

      <div className="relative mt-4 border-t border-white/[0.06] pt-4">
        {contact.email ? (
          <>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 shrink-0 text-fg-muted" />
              <a
                href={`mailto:${contact.email}`}
                className="min-w-0 flex-1 truncate text-sm text-fg-subtle underline-offset-4 transition-colors duration-200 hover:text-fg hover:underline"
              >
                {contact.email}
              </a>
              <button
                type="button"
                onClick={() => onCopy(contact.email!)}
                aria-label={copied ? "Email copié" : "Copier l'email"}
                className={`inline-flex min-w-[4.5rem] shrink-0 items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition duration-200 ease-expo active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                  copied
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-white/[0.08] bg-white/[0.04] text-fg-muted hover:bg-white/[0.08] hover:text-fg"
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
            <div className={`mt-2.5 flex items-center gap-2 text-xs ${quality.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${quality.dot}`} />
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
    <div className="relative animate-pulse overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-card">
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 shrink-0 rounded-xl bg-white/[0.08]" />
        <div className="min-w-0 flex-1">
          <div className="my-1 h-4 w-2/3 rounded bg-white/[0.08]" />
          <div className="mt-1.5 h-[22px] w-1/3 rounded-full bg-white/[0.05]" />
        </div>
        <div className="h-[34px] w-[34px] shrink-0 rounded-lg bg-white/[0.05]" />
      </div>
      <div className="mt-4 border-t border-white/[0.06] pt-4">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 shrink-0 rounded bg-white/[0.05]" />
          <div className="h-4 flex-1 rounded bg-white/[0.08]" />
          <div className="h-[26px] w-[4.5rem] shrink-0 rounded-md bg-white/[0.05]" />
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-white/[0.08]" />
          <div className="h-3 w-1/4 rounded bg-white/[0.05]" />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ siren }: { siren: string }) {
  return (
    <div className="relative mx-auto flex max-w-md animate-scale-in flex-col items-center overflow-hidden rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center">
      <div className="absolute left-1/2 top-0 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[60px]" />
      <div className="relative flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] shadow-inset-highlight">
        <Users className="h-6 w-6 text-fg-muted" />
      </div>
      <h2 className="relative mt-4 text-base font-semibold tracking-tight text-fg">
        Aucun décideur trouvé pour ce SIREN
      </h2>
      <p className="relative mt-1.5 text-sm text-fg-muted">
        Aucun contact n&apos;a pu être identifié pour{" "}
        <span className="font-mono text-fg-subtle">{siren}</span>. Vérifiez le
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
