import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Interface } from "node:readline/promises";

export async function promptConfirmation(
  command: string,
  rl?: Interface
): Promise<boolean> {
  const ownedInterface = !rl;
  const activeRl = rl ?? readline.createInterface({ input, output });
  try {
    const answer = await activeRl.question(`Allow command execution? "${command}" [y/N]: `);
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    if (ownedInterface) {
      activeRl.close();
    }
  }
}
