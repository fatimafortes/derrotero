"use client";

import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  async function handleGoogleSignIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <p className="text-sm font-medium tracking-wide text-accent">
          DERROTERO
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">
          Evidencia de tu propia ruta
        </h1>
        <p className="mt-3 text-sm leading-6 text-foreground/70">
          Inicia sesión con la cuenta de Google de tu asociación para ver el
          mapa, los hallazgos y el control para compartir.
        </p>
        <button
          onClick={handleGoogleSignIn}
          className="mt-8 inline-flex w-full items-center justify-center gap-3 border border-foreground/15 bg-white px-5 py-3 text-sm font-medium text-foreground transition-colors hover:border-foreground/30"
        >
          <GoogleIcon />
          Entrar con Google
        </button>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.98v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.27-1.71V4.96H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.04l2.97-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.96l2.97 2.33C4.66 5.16 6.65 3.58 9 3.58z"
      />
    </svg>
  );
}
