/** Reads captured email from Mailpit (http://localhost:8026) during end-to-end tests. */
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8026';

interface MailpitSearch {
  messages: Array<{ ID: string; Subject: string }>;
}

export async function waitForEmail(
  to: string,
  subject: string,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    );
    const { messages } = (await search.json()) as MailpitSearch;
    const match = messages.find((message) => message.Subject === subject);
    if (match) {
      const message = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      return ((await message.json()) as { Text: string }).Text;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No "${subject}" email for ${to} within ${timeoutMs}ms`);
}
