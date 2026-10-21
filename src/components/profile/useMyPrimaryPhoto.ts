"use client";

/**
 * The signed-in member's own primary photo (proxied `/bff/...` src), for the dashboard header avatar.
 * One request per page load of the dashboard (the shell stays mounted while navigating), cached for the
 * session and refreshed when the photo manager changes something (PHOTOS_CHANGED_EVENT). A member without
 * a photo gets their default avatar (gender + religion, see lib/avatar); one without a profile gets
 * `undefined` and the header keeps showing initials.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { OwnerPhoto, OwnerProfile } from "@/lib/api/types";
import { defaultAvatarSrc } from "@/lib/avatar/defaultAvatar";
import { photoSrc, primaryPhotoUrl } from "@/lib/photo";

export const PHOTOS_CHANGED_EVENT = "rz:photos-changed";

export function useMyPrimaryPhoto(): string | undefined {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    const load = () => {
      api
        .get<{ photos: OwnerPhoto[] }>("/profiles/me/photos")
        .then(async (res) => {
          const photo = photoSrc(primaryPhotoUrl(res.photos));
          if (photo) {
            if (live) setSrc(photo);
            return;
          }
          const { profile } = await api.get<{ profile: OwnerProfile }>("/profiles/me");
          if (live) setSrc(defaultAvatarSrc({ gender: profile.gender, religion: profile.religion?.name, seed: profile.id }));
        })
        .catch(() => {
          if (live) setSrc(undefined); // no profile yet (404) or signed out
        });
    };
    load();
    window.addEventListener(PHOTOS_CHANGED_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(PHOTOS_CHANGED_EVENT, load);
    };
  }, []);

  return src;
}
