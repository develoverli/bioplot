/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public URL of the published extension. Empty until it is published. */
  readonly VITE_EXTENSION_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
