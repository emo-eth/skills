const NORMALIZED_SEQUENCES: Record<string, string> = {
  "\u001bOA": "\u001b[A",
  "\u001bOB": "\u001b[B",
  "\u001bOH": "\u001b[H",
  "\u001bOF": "\u001b[F",
};

export function splitManagerInput(input: string): string[] {
  const commands: string[] = [];
  let index = 0;
  while (index < input.length) {
    if (input[index] === "\u001b") {
      const remainder = input.slice(index);
      const sequence = remainder.match(/^\u001b\[[0-?]*[ -/]*[@-~]/)?.[0]
        ?? remainder.match(/^\u001bO./)?.[0];
      if (sequence) {
        commands.push(NORMALIZED_SEQUENCES[sequence] ?? sequence);
        index += sequence.length;
        continue;
      }
    }
    const codePoint = input.codePointAt(index);
    if (codePoint === undefined) break;
    const command = String.fromCodePoint(codePoint);
    commands.push(command);
    index += command.length;
  }
  return commands;
}
