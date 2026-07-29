interface ImportMetaEnv {
  readonly PYTHON_HTTP_URL: string;
  readonly SDV_AUTH_TOKEN: string;
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}