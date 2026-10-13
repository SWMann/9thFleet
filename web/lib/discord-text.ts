/**
 * Words made safe to post to Discord: nothing in them is read as formatting,
 * as a mention, or as a link.
 *
 * A title can begin as a stranger's words, when an event is drafted from a
 * piracy report. So a link written the way Discord writes one is taken apart,
 * and a web address loses the start that would make it one.
 */
export function discordPlain(text: string): string {
  return text
    .replace(/[*_~`|>@#[\]<]/g, "")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\//gi, "")
    .replace(/\bwww\./gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
