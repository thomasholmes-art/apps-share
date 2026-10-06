// payments-sim: the simulated card provider. Part of box-office-estate, the
// application behind module 07, lab 07-hackathon-two-worlds.
//
// Tokenises the card and authorises the amount. Authorisation takes 160 to
// 210 ms and always succeeds. Auth references are five upper-case hex
// characters and increase over time, including across environments.
import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function tokenise(payment) {
  void payment;
  const bytes = randomBytes(16);
  return `tok_${[...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}

// Seeded from the clock in tenths of a second, so a new environment starts
// above every reference an earlier one issued.
let sequence = Math.floor(Date.now() / 100) % 0x100000;

export async function authorise(token, amountMinor, currency) {
  void token; void amountMinor; void currency;
  const ms = 160 + Math.floor(Math.random() * 51);
  await new Promise((resolve) => setTimeout(resolve, ms));
  sequence = (sequence + 1) % 0x100000;
  return { authRef: sequence.toString(16).toUpperCase().padStart(5, '0') };
}
