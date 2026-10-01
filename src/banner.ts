import { env, stdout } from "node:process";

const PHRASES = [
  "Ajá, ¿entonces qué vamos a montar hoy?",
  "A programar se dijo, cole.",
  "Vamo' a darle, que el código no se escribe solo.",
  "Mi llave, saca la idea y la volvemos código.",
  "Tranquilo, aquí estamos pa' que esto salga.",
  "Cógela suave: hoy sí se programa.",
];

type Rgb = readonly [number, number, number];
export type ColorMode = "truecolor" | "256" | "none";

/** Brand palette: Sol, Horizonte, Acento. */
const PALETTE: Record<string, Rgb> = {
  S: [0xff, 0xc2, 0x3d],
  H: [0xff, 0x6b, 0x4a],
  A: [0x4d, 0xd0, 0xe1],
};

/**
 * One character per square pixel, `.` is empty; two pixel rows make one
 * terminal row. The symbol is the brand's "acentos en ambos lados" variant:
 * sun, horizon with sea accents, and three reflections. The brand forbids
 * adding elements to it.
 */
const LOGO = [
  "......................",
  ".........SSSS.........",
  ".......SSSSSSSS.......",
  "......SSSSSSSSSS......",
  "......SSSSSSSSSS......",
  ".....SSSSSSSSSSSS.....",
  ".....SSSSSSSSSSSS.....",
  "......................",
  "AAHHHHHHHHHHHHHHHHHHAA",
  "AAHHHHHHHHHHHHHHHHHHAA",
  "......................",
  "......SSSSSSSSSS......",
  "......................",
  "........SSSSSS........",
  "......................",
  ".........SSSS.........",
];

const WORDMARK = "Quillami Code";
const LOGO_CENTER = 11;

export function colorMode(): ColorMode {
  if (!stdout.isTTY || env.NO_COLOR) return "none";
  return /^(truecolor|24bit)$/i.test(env.COLORTERM ?? "") ? "truecolor" : "256";
}

function paint(code: string, text: string): string {
  if (colorMode() === "none") return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export function dim(text: string): string {
  return paint("2;37", text);
}

export function bold(text: string): string {
  return paint("1", text);
}

export function red(text: string): string {
  return paint("31", text);
}

export function green(text: string): string {
  return paint("32", text);
}

export function cyan(text: string): string {
  return paint("36", text);
}

export function sol(text: string): string {
  const mode = colorMode();
  if (mode === "none") return text;
  return `\x1b[${sgr(PALETTE.S, "fg", mode)}m${text}\x1b[0m`;
}

/** Nearest color in the xterm 6×6×6 cube, for terminals without 24-bit color. */
function xterm256([r, g, b]: Rgb): number {
  const level = (value: number) => (value < 48 ? 0 : value < 115 ? 1 : Math.min(5, Math.floor((value - 35) / 40)));
  return 16 + 36 * level(r) + 6 * level(g) + level(b);
}

function sgr(rgb: Rgb, layer: "fg" | "bg", mode: ColorMode): string {
  if (mode === "truecolor") return `${layer === "fg" ? 38 : 48};2;${rgb.join(";")}`;
  return `${layer === "fg" ? 38 : 48};5;${xterm256(rgb)}`;
}

function cell(top: Rgb | undefined, bottom: Rgb | undefined, mode: ColorMode): string {
  if (!top && !bottom) return " ";
  const glyph = top && bottom ? (top === bottom ? "█" : "▀") : top ? "▀" : "▄";
  if (mode === "none") return top && bottom ? "█" : glyph;
  const codes = [sgr((top ?? bottom)!, "fg", mode)];
  if (top && bottom && top !== bottom) codes.push(sgr(bottom, "bg", mode));
  return `\x1b[${codes.join(";")}m${glyph}\x1b[0m`;
}

export function renderLogo(mode: ColorMode): string[] {
  const lines: string[] = [];
  for (let row = 0; row < LOGO.length; row += 2) {
    const top = LOGO[row];
    const bottom = LOGO[row + 1] ?? "";
    let line = "";
    for (let col = 0; col < Math.max(top.length, bottom.length); col += 1) {
      line += cell(PALETTE[top[col]], PALETTE[bottom[col]], mode);
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function printBanner(): void {
  const mode = colorMode();
  const phrase = PHRASES[Math.floor(Math.random() * PHRASES.length)];
  const indent = "   ";
  const wordmark = " ".repeat(Math.round(LOGO_CENTER - WORDMARK.length / 2)) + WORDMARK;
  const art = [
    ...renderLogo(mode).map((line) => indent + line),
    "",
    indent + paint("1;97", wordmark),
    "",
    indent + dim(phrase),
  ];
  console.log(`\n${art.join("\n")}\n`);
}
