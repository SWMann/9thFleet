/**
 * The questions on the application form. Change the wording here and the form
 * follows. Each answer is stored with the question as it was asked, so an old
 * application still reads correctly after the wording changes.
 */
export const questions = [
  {
    id: "why",
    label: "Why do you want to join the 9th Fleet?",
    hint: "What you are looking for, and what made you pick this fleet.",
    required: true,
    max: 1000,
    rows: 5,
  },
  {
    id: "experience",
    label: "What have you done in Star Citizen so far?",
    hint: "How long you have played, what you fly and the work you like.",
    required: true,
    max: 1000,
    rows: 4,
  },
  {
    id: "units",
    label: "Have you been in an organised unit before, in any game?",
    hint: "Say which, and why you left. It is fine if you have not.",
    required: false,
    max: 1000,
    rows: 3,
  },
  {
    id: "evenings",
    label: "Which evenings can you usually make?",
    hint: "The fleet runs a training evening and an operations evening each week, in UK time. Give your time zone.",
    required: true,
    max: 300,
    rows: 2,
  },
] as const;

/** Things an applicant has to confirm. They match "What you need" on the standards page. */
export const confirmations = [
  { id: "age", statement: "I am 18 or over." },
  { id: "kit", statement: "I play Star Citizen on a Windows PC and have a working microphone." },
  { id: "standards", statement: "I have read the standards and will keep to them." },
] as const;

export type StoredAnswers = {
  answers: { question: string; answer: string }[];
  confirmed: string[];
};

/**
 * Read what an application holds. An applicant could send anything to the
 * database directly, so nothing here is trusted: only text is kept, and only
 * so much of it.
 */
export function readStoredAnswers(stored: unknown): StoredAnswers {
  const text = (value: unknown, limit: number) => (typeof value === "string" ? value.slice(0, limit) : "");
  const list = (value: unknown) => (Array.isArray(value) ? value.slice(0, 20) : []);
  const record = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  return {
    answers: list(record.answers)
      .map((item) => {
        const entry = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        return { question: text(entry.question, 300), answer: text(entry.answer, 2000) };
      })
      .filter((entry) => entry.question !== "" && entry.answer !== ""),
    confirmed: list(record.confirmed)
      .map((item) => text(item, 300))
      .filter((statement) => statement !== ""),
  };
}

/**
 * Text from a form field, tidied. A browser sends each line break as two
 * characters. One is kept, so the text is stored the way it was typed.
 */
export function typed(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
}

export const serviceNames = { navy: "Navy", army: "Army", marines: "Marines" } as const;

export const stageNames = {
  submitted: "Waiting to be read",
  interview: "At interview",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
} as const;

/** A date as the fleet writes it, in UTC so everyone reads the same day. */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(iso),
  );
}
