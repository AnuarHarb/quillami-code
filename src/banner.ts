import { stdout } from "node:process";

const PHRASES = [
  "Ajá, ¿entonces qué vamos a montar hoy?",
  "A programar se dijo, cole.",
  "Vamo' a darle, que el código no se escribe solo.",
  "Mi llave, saca la idea y la volvemos código.",
  "Tranquilo, aquí estamos pa' que esto salga.",
  "Cogela suave: hoy sí se programa.",
];

function paint(code: string, text: string): string {
  if (!stdout.isTTY) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export function dim(text: string): string {
  return paint("2;37", text);
}

export function printBanner(): void {
  const phrase = PHRASES[Math.floor(Math.random() * PHRASES.length)];

  const art = [
    `${paint("33", "              \\ | /")}            ${paint("32", ")")}`,
    `${paint("33", "            -- (o) --")}          ${paint("32", "(((")}`,
    `${paint("33", "              / | \\")}            ${paint("32", "||")}`,
    paint("36", "         ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~"),
    paint("36", "        ~~~~~~~~~~~~~~~~~~~~~~~~"),
    "",
    paint("1;36", "        Q U I L L A M I"),
    paint("1;37", "              C O D E"),
    "",
    `   ${paint("2;37", phrase)}`,
  ];

  console.log(`\n${art.join("\n")}\n`);
}
