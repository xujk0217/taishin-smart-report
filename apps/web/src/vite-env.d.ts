/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GROQ_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
