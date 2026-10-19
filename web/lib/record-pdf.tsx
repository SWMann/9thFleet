import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { activity, currentPost, dutyTermEnds, gradeChanges, gradePeriods, gradeSince, latestFirst, lengthBetween, returnedNames, statusLabel, statusSteps, today, type GradeChange } from "@/lib/record";
import { plainText } from "@/lib/rich/markdown";
import type { ServiceRecord } from "@/lib/service-record";
import type { TrainingLine } from "@/lib/training";
import { progressWords } from "@/lib/training-form";

/**
 * A member's service record as a PDF: the same record the page shows, laid
 * out to keep or print. Text only; nothing is drawn that a reader cannot
 * read aloud.
 */

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const day = (date: string) => dayFormat.format(new Date(date.length === 10 ? `${date}T00:00:00Z` : date));

const ink = "#161a22";
const muted = "#5b6270";
const rule = "#c9ced8";
const gold = "#8a6a1f";

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 52, fontFamily: "Helvetica", fontSize: 10, color: ink, lineHeight: 1.4 },
  fleet: { fontSize: 9, letterSpacing: 2, color: gold, textTransform: "uppercase", fontFamily: "Helvetica-Bold" },
  title: { fontSize: 20, lineHeight: 1.25, fontFamily: "Helvetica-Bold", marginTop: 6, marginBottom: 2 },
  lead: { fontSize: 10, color: muted, marginTop: 4 },
  section: { marginTop: 18 },
  heading: { fontSize: 12, fontFamily: "Helvetica-Bold", paddingBottom: 3, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: rule },
  row: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: rule },
  head: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: ink },
  th: { fontFamily: "Helvetica-Bold", fontSize: 9, color: muted, textTransform: "uppercase", letterSpacing: 0.5 },
  cell: { paddingRight: 6 },
  small: { fontSize: 8.5, color: muted },
  stat: { width: "25%", paddingRight: 8 },
  statValue: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  statLabel: { fontSize: 8.5, color: muted, textTransform: "uppercase", letterSpacing: 0.5 },
  item: { marginBottom: 4 },
  note: { fontSize: 9, color: muted, marginTop: 6 },
  footer: { position: "absolute", left: 52, right: 52, bottom: 28, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: muted },
});

const changeWords: Record<GradeChange["kind"], string> = {
  promoted: "Promoted to",
  reduced: "Reduced to",
  confirmed: "Confirmed as",
  "made-acting": "Made acting",
};
const beforeWords = {
  applicant: "as an applicant",
  recruit: "as a recruit",
  auxiliary: "as an auxiliary",
  member: "as a full member",
  reserve: "in reserve",
  discharged: "out of the fleet",
} as const;

export type RecordHead = {
  name: string;
  rank: string | null;
  service: string | null;
  status: string;
  post: string | null;
  unit: string | null;
};

const Cell = ({ width, children, bold = false, small = false }: { width: string; children: React.ReactNode; bold?: boolean; small?: boolean }) => (
  <View style={[styles.cell, { width }]}>
    <Text style={[bold ? { fontFamily: "Helvetica-Bold" } : {}, small ? styles.small : {}]}>{children}</Text>
  </View>
);

function RecordDocument({ head, record, training, attendance }: { head: RecordHead; record: ServiceRecord; training: TrainingLine[]; attendance: boolean }) {
  const now = record.readAt;
  const on = today(now);
  const rank = (gradeCode: string | null, acting = false) => {
    if (!gradeCode) return "";
    const name = record.rankNames.get(gradeCode);
    return name ? `${acting ? "Acting " : ""}${name}` : gradeCode;
  };
  const posts = latestFirst(record.posts);
  const post = currentPost(record.posts);
  const grade = gradeSince(gradePeriods(record.posts, record.gradeLines));
  const seen = activity(record.events, now);
  const titleOf = new Map(record.posts.map((entry) => [entry.id, entry.title]));
  const steps = [
    ...statusSteps(record.statusLines).map((step) => ({
      on: step.on,
      key: `status-${step.id}`,
      what: statusLabel(step),
      detail: step.before && step.beforeSince && step.before !== "applicant" ? `After ${lengthBetween(step.beforeSince, step.on).toLowerCase()} ${beforeWords[step.before]}.` : "",
    })),
    ...gradeChanges(record.posts, record.gradeLines, record.gradeOrder).map((change) => ({
      on: change.on,
      key: `grade-${change.id}`,
      what: `${changeWords[change.kind]} ${rank(change.gradeCode, change.kind !== "made-acting" && change.acting)}`,
      detail: `${change.gradeCode}, as ${titleOf.get(change.assignmentId) ?? "a post"}.`,
    })),
  ]
    .sort((a, b) => a.on.localeCompare(b.on))
    .reverse();

  return (
    <Document title={`Service record: ${head.name}`} author="UEE 9th Fleet" creator="UEE 9th Fleet" producer="UEE 9th Fleet">
      <Page size="A4" style={styles.page}>
        <Text style={styles.fleet}>UEE 9th Fleet · Task Force Jericho</Text>
        <Text style={styles.title}>{head.rank ? `${head.rank} ${head.name}` : head.name}</Text>
        <Text style={styles.lead}>
          Service record. {head.status}
          {head.service ? `, ${head.service}` : ""}
          {head.post ? `. ${head.post}, ${head.unit}` : ""}. As at {day(on)}.
        </Text>

        <View style={styles.section}>
          <Text style={styles.heading}>Time served</Text>
          <View style={{ flexDirection: "row" }}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>In post</Text>
              <Text style={styles.statValue}>{post ? lengthBetween(post.startedOn, on) : "None"}</Text>
              <Text style={styles.small}>{post ? `${post.title}, since ${day(post.startedOn)}` : "Holds no post at the moment"}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>At this rank</Text>
              <Text style={styles.statValue}>{grade ? lengthBetween(grade.since, on) : "None"}</Text>
              <Text style={styles.small}>{grade ? `${rank(grade.gradeCode, grade.acting)}, since ${day(grade.since)}` : "Counted while a post is held"}</Text>
            </View>
            {attendance ? (
              <>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Events, 30 days</Text>
                  <Text style={styles.statValue}>{seen.in30}</Text>
                  <Text style={styles.small}>Returned present</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Events, 90 days</Text>
                  <Text style={styles.statValue}>{seen.in90}</Text>
                  <Text style={styles.small}>{seen.all === 1 ? "1 in all" : `${seen.all} in all`}</Text>
                </View>
              </>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Posts held</Text>
          {posts.length === 0 ? (
            <Text style={styles.note}>No post held yet.</Text>
          ) : (
            <>
              <View style={styles.head}>
                <Cell width="36%">
                  <Text style={styles.th}>Post</Text>
                </Cell>
                <Cell width="22%">
                  <Text style={styles.th}>Held as</Text>
                </Cell>
                <Cell width="14%">
                  <Text style={styles.th}>From</Text>
                </Cell>
                <Cell width="14%">
                  <Text style={styles.th}>To</Text>
                </Cell>
                <Cell width="14%">
                  <Text style={styles.th}>For</Text>
                </Cell>
              </View>
              {posts.map((entry) => (
                <View style={styles.row} key={entry.id} wrap={false}>
                  <View style={[styles.cell, { width: "36%" }]}>
                    <Text style={{ fontFamily: "Helvetica-Bold" }}>{entry.title}</Text>
                    <Text style={styles.small}>{entry.unit}</Text>
                  </View>
                  <Cell width="22%">{entry.kind === "duty" ? `Duty${!entry.endedOn ? `, term to ${day(dutyTermEnds(entry))}` : ""}` : `${rank(entry.gradeCode, entry.acting)}${entry.gradeCode ? ` (${entry.gradeCode})` : ""}`}</Cell>
                  <Cell width="14%">{day(entry.startedOn)}</Cell>
                  <Cell width="14%">{entry.endedOn ? day(entry.endedOn) : "Now"}</Cell>
                  <Cell width="14%">{lengthBetween(entry.startedOn, entry.endedOn ?? on)}</Cell>
                </View>
              ))}
            </>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Standing and promotions</Text>
          {steps.length === 0 ? (
            <Text style={styles.note}>Nothing has been recorded yet.</Text>
          ) : (
            steps.map((step) => (
              <View style={styles.row} key={step.key} wrap={false}>
                <Cell width="18%">{day(step.on)}</Cell>
                <View style={[styles.cell, { width: "82%" }]}>
                  <Text style={{ fontFamily: "Helvetica-Bold" }}>{step.what}</Text>
                  {step.detail ? <Text style={styles.small}>{step.detail}</Text> : null}
                </View>
              </View>
            ))
          )}
        </View>

        {attendance ? (
          <View style={styles.section}>
            <Text style={styles.heading}>Events attended</Text>
            {record.events.length === 0 ? (
              <Text style={styles.note}>{"On no event's return yet."}</Text>
            ) : (
              <>
                <Text style={styles.note}>
                  {seen.all === 1 ? "Present at 1 event" : `Present at ${seen.all} events`}
                  {seen.absent > 0 ? `, absent from ${seen.absent}` : ""}.
                </Text>
                <View style={styles.head}>
                  <Cell width="46%">
                    <Text style={styles.th}>Event</Text>
                  </Cell>
                  <Cell width="20%">
                    <Text style={styles.th}>Type</Text>
                  </Cell>
                  <Cell width="16%">
                    <Text style={styles.th}>Date</Text>
                  </Cell>
                  <Cell width="18%">
                    <Text style={styles.th}>Returned</Text>
                  </Cell>
                </View>
                {record.events.map((event) => (
                  <View style={styles.row} key={event.id} wrap={false}>
                    <Cell width="46%" bold>
                      {event.title}
                    </Cell>
                    <Cell width="20%">{event.type}</Cell>
                    <Cell width="16%">{day(event.startsAt)}</Cell>
                    <Cell width="18%">{returnedNames[event.returned]}</Cell>
                  </View>
                ))}
              </>
            )}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.heading}>Qualifications</Text>
          {record.qualifications.length === 0 ? (
            <Text style={styles.note}>None yet.</Text>
          ) : (
            record.qualifications.map((qualification) => (
              <View style={styles.item} key={`${qualification.name}-${qualification.awardedOn}`} wrap={false}>
                <Text>
                  <Text style={{ fontFamily: "Helvetica-Bold" }}>{qualification.name}</Text>
                  <Text style={styles.small}>
                    {"  "}
                    {day(qualification.awardedOn)}
                    {qualification.event ? `, at ${qualification.event.title}` : ""}
                  </Text>
                </Text>
              </View>
            ))
          )}
          {training.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              <Text style={[styles.th, { marginBottom: 3 }]}>In training</Text>
              {training.map((line) => (
                <View style={styles.item} key={line.course} wrap={false}>
                  <Text>
                    <Text style={{ fontFamily: "Helvetica-Bold" }}>{line.course}</Text>
                    <Text style={styles.small}>
                      {"  "}
                      {progressWords(line.passed, line.lessons)}
                    </Text>
                  </Text>
                  {line.lines.map((lesson) => (
                    <Text style={styles.small} key={lesson.lesson}>
                      {lesson.lesson}
                      {lesson.passedOn ? `: passed ${day(lesson.passedOn)}${lesson.signedBy ? `, ${lesson.signedBy}` : ""}` : ": not yet"}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Mentions</Text>
          {record.mentions.length === 0 ? (
            <Text style={styles.note}>None yet.</Text>
          ) : (
            record.mentions.map((mention) => (
              <View style={styles.item} key={mention.event.id} wrap={false}>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{plainText(mention.citation)}</Text>
                <Text style={styles.small}>
                  {mention.event.title}, {day(mention.mentionedAt)}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.footer} fixed>
          <Text>UEE 9th Fleet is a player-run organisation. Not affiliated with Cloud Imperium Games.</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** The record as a PDF file. */
export async function recordPdf(head: RecordHead, record: ServiceRecord, training: TrainingLine[], attendance: boolean): Promise<Buffer> {
  return renderToBuffer(<RecordDocument head={head} record={record} training={training} attendance={attendance} />);
}
