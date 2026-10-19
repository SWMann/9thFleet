import { getSession, isServing } from "@/lib/member";
import { recordPdf } from "@/lib/record-pdf";
import { getServiceRecord } from "@/lib/service-record";
import { getTrainingRecord } from "@/lib/training";
import { serviceNames, statusNames } from "@/lib/admin";

/**
 * The signed-in member's own service record as a PDF. It is read through
 * their own access, so it holds exactly what their record page shows them.
 */
export async function GET() {
  const session = await getSession();
  if (session.state !== "member") return new Response("Not found.", { status: 404 });
  const { member } = session;
  const serving = isServing(member);
  const [record, training] = await Promise.all([getServiceRecord(member.id, member.service), serving ? getTrainingRecord(member.id) : Promise.resolve([])]);
  const file = await recordPdf(
    {
      name: member.characterName ?? member.discordName ?? "A member",
      rank: member.rankName ? `${member.acting ? "Acting " : ""}${member.rankName}` : null,
      service: member.service ? serviceNames[member.service] : null,
      status: statusNames[member.status],
      post: member.postTitle,
      unit: member.unitName,
    },
    record,
    training,
    serving,
  );
  const name = (member.characterName ?? "record").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "record";
  return new Response(new Uint8Array(file), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="service-record-${name}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
