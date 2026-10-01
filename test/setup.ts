// node:test reads each test file's results from its stdout as binary chunks; text printed by the
// code under test can land in the middle of one and fail the whole file. Only binary goes through.
const write = process.stdout.write.bind(process.stdout);

process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
  if (typeof chunk !== "string") return write(chunk, ...(rest as never[]));
  const done = rest.at(-1);
  if (typeof done === "function") done();
  return true;
}) as typeof process.stdout.write;
