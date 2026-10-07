import { describe, expect, it } from "vitest";
import { urlPublica } from "../supabase/functions/_shared/url-publica.ts";

const FIRMADA =
  "http://kong:8000/storage/v1/object/sign/documentos/productors/x/2026/REC/REC-2026-00001-v1.pdf?token=abc.def";

describe("urlPublica", () => {
  it("sin variable, deja la URL tal cual (producción)", () => {
    expect(urlPublica(FIRMADA, undefined)).toBe(FIRMADA);
    expect(urlPublica(FIRMADA, "")).toBe(FIRMADA);
    expect(urlPublica(FIRMADA, "   ")).toBe(FIRMADA);
  });

  it("cambia solo el origen y conserva ruta y token", () => {
    expect(urlPublica(FIRMADA, "http://127.0.0.1:55321")).toBe(
      "http://127.0.0.1:55321/storage/v1/object/sign/documentos/productors/x/2026/REC/REC-2026-00001-v1.pdf?token=abc.def",
    );
  });

  it("acepta una base con barra final o con ruta", () => {
    expect(urlPublica(FIRMADA, "http://127.0.0.1:55321/")).toBe(
      urlPublica(FIRMADA, "http://127.0.0.1:55321"),
    );
    expect(urlPublica(FIRMADA, "https://proxy.test/supabase/")).toBe(
      "https://proxy.test/supabase/storage/v1/object/sign/documentos/productors/x/2026/REC/REC-2026-00001-v1.pdf?token=abc.def",
    );
  });

  it("ante una base mal formada no rompe la descarga", () => {
    expect(urlPublica(FIRMADA, "no-es-una-url")).toBe(FIRMADA);
  });
});
