import "server-only";

/**
 * Tell the fleet's Discord channel that an event has been announced.
 *
 * It says only what type of event it is, its title, when it starts and where
 * on this site to read it. The orders stay behind sign-in.
 *
 * The channel's webhook address is a secret. It is read from the server's
 * environment, where the Fleet Commander puts it, and it is never written to a
 * log or sent anywhere but Discord. With no address set, nothing is posted.
 */

/** A Discord webhook, and nothing else: a mistyped address must not send the announcement elsewhere. */
const DISCORD = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
/** A stand-in on this machine, which is what the tests post to. */
const THIS_MACHINE = /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/api\/webhooks\/[\w/-]+$/;

export type Announcement = { type: string; title: string; startsAt: string; link: string };

/** What an admin typed, with the characters Discord reads as formatting or as a mention taken out. */
const plain = (text: string) => text.replace(/[*_~`|>@#]/g, "").replace(/\s+/g, " ").trim();

/** Whether a webhook address is set, so the site can say whether an announcement will be posted. */
export const discordIsOn = () => Boolean(process.env.DISCORD_ANNOUNCE_WEBHOOK?.trim());

export async function announceOnDiscord(event: Announcement): Promise<"posted" | "off" | "failed"> {
  const address = process.env.DISCORD_ANNOUNCE_WEBHOOK?.trim();
  if (!address) return "off";
  if (!DISCORD.test(address) && !THIS_MACHINE.test(address)) return "failed";

  // Discord shows <t:…> in each reader's own time.
  const at = Math.floor(Date.parse(event.startsAt) / 1000);
  const content = `**${plain(event.type)}: ${plain(event.title)}**\n<t:${at}:F> (<t:${at}:R>)\n${event.link}`;
  try {
    const response = await fetch(address, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Nothing in the message can ping anyone, whatever the title says.
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      // The address was checked above, so the post goes there and is not sent on anywhere else.
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok ? "posted" : "failed";
  } catch {
    return "failed";
  }
}
