interface ImportMetaEnv {
  readonly PYTHON_HTTP_URL: string;
  readonly PYTHON_HTTP_TOKEN: string;
  readonly SDV_AUTH_TOKEN: string;
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}