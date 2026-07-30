/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GROQ_KEY?: string;
  readonly VITE_OPENCODE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
