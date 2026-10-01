export const MAX_TOOL_OUTPUT_CHARS = 30_000;

/** Keeps the start and end of long text; errors and summaries usually live at the tail. */
export function truncateMiddle(text: string, maxChars = MAX_TOOL_OUTPUT_CHARS): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars / 2);
  const tail = maxChars - head;
  const omitted = text.length - head - tail;
  const omittedLines = text.slice(head, text.length - tail).split("\n").length - 1;
  return (
    `${text.slice(0, head)}\n\n` +
    `... [omitted ${omitted} characters, ${omittedLines} lines] ...\n\n` +
    text.slice(text.length - tail)
  );
}

/**
 * Collects a stream without holding all of it: the first and last `keep / 2`
 * characters survive, and the count of dropped characters is remembered.
 */
export class HeadTailBuffer {
  private head = "";
  private tail = "";
  private dropped = 0;
  private readonly half: number;

  constructor(keep: number) {
    this.half = Math.floor(keep / 2);
  }

  push(chunk: string): void {
    if (this.head.length < this.half) {
      const room = this.half - this.head.length;
      this.head += chunk.slice(0, room);
      chunk = chunk.slice(room);
    }
    if (!chunk) return;
    this.tail += chunk;
    if (this.tail.length > this.half) {
      this.dropped += this.tail.length - this.half;
      this.tail = this.tail.slice(this.tail.length - this.half);
    }
  }

  toString(): string {
    if (this.dropped === 0) return this.head + this.tail;
    return `${this.head}\n\n... [omitted ${this.dropped} characters] ...\n\n${this.tail}`;
  }
}
