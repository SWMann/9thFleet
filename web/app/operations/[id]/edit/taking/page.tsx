import type { Metadata } from "next";
import { Suspense } from "react";
import { ExtraPostForm, KeyPostsForm, RemoveExtraPost, UnitsForm } from "../../../OpsForms";
import { EditHead, EditNav, openForEdit } from "../frame";

export const metadata: Metadata = {
  title: "Who takes part",
  robots: { index: false, follow: false },
};

type Props = PageProps<"/operations/[id]/edit/taking">;

export default function TakingPartPage({ params }: Props) {
  return (
    <Suspense fallback={<EditHead title="Event" lead="Reading the event." />}>
      <TakingPart params={params} />
    </Suspense>
  );
}

async function TakingPart({ params }: { params: Props["params"] }) {
  const opened = await openForEdit((await params).id);
  if ("shut" in opened) return opened.shut;
  const { event, choices, taking, roll } = opened.result;

  return (
    <>
      <EditHead id={event.id} title={event.title} lead="The units it is for, the posts it needs filled, and posts of its own for the night." />
      <section className="wrap band band-last" aria-labelledby="taking">
        <EditNav id={event.id} current="taking" />
        <h2 id="taking">
          Who takes <strong>part</strong>
        </h2>
        <UnitsForm id={event.id} units={choices.units} chosen={taking.units} />
        <KeyPostsForm id={event.id} groups={choices.posts} chosen={taking.keyPosts} />
        <div className="extra-posts">
          <h3 className="extra-posts-title">Posts for this event only</h3>
          <p className="hint">
            A post the order of battle does not have, for this one night: a range safety officer, an umpire, trainees.
            Each is listed on the roll, where it is filled like any other post.
          </p>
          {roll.extra.length > 0 ? (
            <ul>
              {roll.extra.map((post) => (
                <li key={post.id}>
                  <span>
                    {post.title}
                    <small>
                      {[post.role?.name, post.mustFill ? "must be filled" : null, post.openToVolunteers ? "open to volunteers" : null]
                        .filter(Boolean)
                        .join(", ")}
                    </small>
                  </span>
                  <RemoveExtraPost id={event.id} post={post.id} title={post.title} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <ExtraPostForm id={event.id} roles={choices.roles} />
      </section>
    </>
  );
}
