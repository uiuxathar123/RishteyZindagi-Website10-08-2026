"use client";

import { Crown } from "lucide-react";
import { NotAvailable, PageHeader } from "./AdminUi";
import { GatewaysPanel, MatchingWeightsPanel, OtpConfigPanel } from "./SettingsPanels";

/** `/admin/super/settings` — platform-wide configuration only a Super Admin should change. */
export function PlatformSettingsClient() {
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Platform Settings"
        icon={<Crown className="h-5 w-5 text-rz-gold-rich" strokeWidth={1.8} />}
        description="OTP delivery, match scoring and payment gateways for the whole platform — Super Admin only."
      />
      <OtpConfigPanel />
      <MatchingWeightsPanel />
      <GatewaysPanel />
      <NotAvailable title="Feature flags">
        The platform has no feature-flag store, so there are no flag switches here.
      </NotAvailable>
    </div>
  );
}
