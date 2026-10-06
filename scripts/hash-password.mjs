// Turn a portal password into the bcrypt hash that goes in the
// MANAGER_PORTAL_PASSWORD_HASH environment variable on Netlify.
//
//   npm run hash-password
//
// The password is typed at a hidden prompt: it never appears on screen, in
// your shell history, or in any file. Only the hash is printed.
import bcrypt from "bcryptjs";
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl._writeToOutput = (s) => {
  if (s.includes("Password")) rl.output.write(s);
};

rl.question("Password for the manager portal: ", async (password) => {
  rl.close();
  process.stdout.write("\n");
  if (!password || password.length < 8) {
    console.error("Use at least 8 characters.");
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  console.log("\nPaste this into Netlify as MANAGER_PORTAL_PASSWORD_HASH (mark it secret):\n");
  console.log(hash);
});
