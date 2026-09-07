interface ImportMetaEnv {
  readonly PYTHON_HTTP_URL: string;
  readonly PYTHON_HTTP_TOKEN: string;
  readonly SDV_AUTH_TOKEN: string;
  readonly APP_VERSION: string;
  readonly SEASON_MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
    interface Locals {
        preview?: boolean;
        adminAuthed?: boolean;
        /** vetted audit identity: basic-auth username or "admin-cookie" */
        adminActor?: string;
    }
  interface SessionData {
    favorites?: {
      teams?: (string | number)[];
      games?: (string | number)[];
    }
  }
}