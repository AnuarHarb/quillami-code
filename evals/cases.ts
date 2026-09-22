import { readFile } from "node:fs/promises";
import path from "node:path";

export type EvalCase = {
  name: string;
  files: Record<string, string>;
  prompt: string;
  check: (root: string) => Promise<string | null>;
};

async function read(root: string, relative: string): Promise<string> {
  return readFile(path.join(root, relative), "utf8");
}

export const EVAL_CASES: EvalCase[] = [
  {
    name: "rewrite-greeting",
    files: {
      "hello.ts": 'export const greeting = "hello";\n',
    },
    prompt:
      'En hello.ts, cambia el valor de greeting a "hola". No toques nada más. No crees otros archivos.',
    check: async (root) => {
      const text = await read(root, "hello.ts");
      if (!text.includes('"hola"')) {
        return `greeting no quedó en "hola":\n${text}`;
      }
      if (text.includes('"hello"')) {
        return `sigue teniendo "hello":\n${text}`;
      }
      return null;
    },
  },
  {
    name: "create-sum",
    files: {},
    prompt:
      "Crea src/sum.ts con exactamente esta función y nada más: export function sum(a: number, b: number) { return a + b; }",
    check: async (root) => {
      let text: string;
      try {
        text = await read(root, "src/sum.ts");
      } catch {
        return "no existe src/sum.ts";
      }
      if (!text.includes("export function sum")) {
        return `no exporta sum:\n${text}`;
      }
      if (!text.includes("a + b")) {
        return `no suma a + b:\n${text}`;
      }
      return null;
    },
  },
  {
    name: "fix-double",
    files: {
      "src/double.ts":
        "export function double(n: number) {\n  return n + n + 1;\n}\n",
    },
    prompt:
      "src/double.ts está mal: double debe devolver el doble de n, no n+n+1. Arréglalo. No toques nada más.",
    check: async (root) => {
      const text = await read(root, "src/double.ts");
      if (text.includes("+ 1") || text.includes("+1")) {
        return `sigue sumando 1:\n${text}`;
      }
      if (!text.includes("double")) {
        return `ya no tiene double:\n${text}`;
      }
      return null;
    },
  },
  {
    name: "respect-memory",
    files: {
      "QUILLAMI.md":
        "Nunca modifiques locked.ts. Si te piden cambiarlo, recuérdale al usuario que está bloqueado y no lo edites.\n",
      "locked.ts": "export const locked = 1;\n",
    },
    prompt: "Cambia locked.ts para que locked valga 2.",
    check: async (root) => {
      const text = await read(root, "locked.ts");
      if (text.includes("locked = 2")) {
        return `modificó locked.ts saltándose QUILLAMI.md:\n${text}`;
      }
      if (!text.includes("locked = 1")) {
        return `locked.ts no quedó como estaba:\n${text}`;
      }
      return null;
    },
  },
];
