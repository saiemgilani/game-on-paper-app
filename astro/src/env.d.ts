interface ImportMetaEnv {
  readonly SUMMARY_HTTP_URL: string;
  readonly PYTHON_HTTP_URL: string;
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}