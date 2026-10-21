"use client";

import { defaultAvatarSrc } from "@/lib/avatar/defaultAvatar";
import { AsyncView } from "@/components/ui/AsyncView";
import { Skeleton } from "@/components/ui/States";
import { Tabs } from "@/components/ui/Tabs";
import { PhotoManager } from "@/components/profile/photos/PhotoManager";
import { api } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import { useReference } from "@/lib/api/lookups";
import type { OwnerProfile } from "@/lib/api/types";
import { ReactNode, useState } from "react";
import { CreateProfileStep } from "./profile/CreateProfileStep";
import { PartnerPreferencesPanel } from "./profile/PartnerPreferencesPanel";
import { AboutSection, BasicSection, CareerSection, FamilySection, IncomeSection, LifestyleSection, LocationSection } from "./profile/ProfileSections";
import { StatusPanel } from "./profile/StatusPanel";
import type { EditorTab } from "./profile/profileForm";

const TAB_ITEMS: Array<{ id: EditorTab; label: string }> = [
  { id: "basic", label: "Basic Details" },
  { id: "about", label: "About & Bio" },
  { id: "career", label: "Education & Career" },
  { id: "lifestyle", label: "Lifestyle & Family" },
  { id: "photos", label: "Photos" },
  { id: "preferences", label: "Partner Preferences" },
];

function EditorSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading your profile">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

/**
 * The member's own profile, on the real API.
 *
 * `GET /profiles/me/completion` is the loader: unlike `GET /profiles/me` it
 * returns the full owner view (resolved lookups, photos) together with the
 * backend-computed completion percentage, status and missing fields. A 404
 * means the account has no profile yet and the create step is shown.
 */
export function ProfileEditor() {
  const load = useAsync(async (signal) => (await api.get<{ profile: OwnerProfile }>("/profiles/me/completion", { signal })).profile, []);
  const reference = useReference();
  const [tab, setTab] = useState<EditorTab>("basic");
  const [visited, setVisited] = useState<Set<EditorTab>>(new Set(["basic"]));

  function goto(next: EditorTab) {
    setTab(next);
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)));
  }

  if (load.error?.kind === "not_found" && load.data === null) {
    return <CreateProfileStep onCreated={load.reload} />;
  }

  return (
    <AsyncView data={load.data} error={load.error} loading={load.loading} reload={load.reload} skeleton={<EditorSkeleton />}>
      {(profile) => {
        const onSaved = (p: OwnerProfile) => load.setData(p);
        const ref = reference.data;
        const panel = (id: EditorTab, content: ReactNode) =>
          visited.has(id) ? (
            <div key={id} role="tabpanel" hidden={tab !== id} className="space-y-6">
              {content}
            </div>
          ) : null;

        return (
          <div>
            <StatusPanel profile={profile} onGoto={goto} />

            {reference.error && (
              <p role="alert" className="mb-4 rounded-md border border-rz-danger/30 bg-rz-danger/5 px-4 py-3 text-sm text-rz-danger">
                We couldn’t load the dropdown options (religion, education and so on), so those fields can’t be edited right now. Please refresh the page to try again.
              </p>
            )}

            <div className="rounded-lg border border-rz-border bg-white p-5 md:p-6">
              <Tabs items={TAB_ITEMS} activeTab={tab} onChange={(id) => goto(id as EditorTab)}>
                {() => (
                  <>
                    {panel(
                      "basic",
                      <>
                        <BasicSection profile={profile} reference={ref} onSaved={onSaved} />
                        <LocationSection profile={profile} reference={ref} onSaved={onSaved} />
                      </>
                    )}
                    {panel("about", <AboutSection profile={profile} onSaved={onSaved} />)}
                    {panel(
                      "career",
                      <>
                        <CareerSection profile={profile} reference={ref} onSaved={onSaved} />
                        <IncomeSection profile={profile} onSaved={onSaved} />
                      </>
                    )}
                    {panel(
                      "lifestyle",
                      <>
                        <LifestyleSection profile={profile} onSaved={onSaved} />
                        <FamilySection profile={profile} onSaved={onSaved} />
                      </>
                    )}
                    {panel(
                      "photos",
                      <PhotoManager
                        photos={profile.photos}
                        onChanged={load.reload}
                        defaultAvatar={defaultAvatarSrc({ gender: profile.gender, religion: profile.religion?.name, seed: profile.id })}
                      />
                    )}
                    {panel("preferences", <PartnerPreferencesPanel reference={ref} />)}
                  </>
                )}
              </Tabs>
            </div>
          </div>
        );
      }}
    </AsyncView>
  );
}
