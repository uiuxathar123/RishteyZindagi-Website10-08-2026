"use client";

import { Crown } from "lucide-react";
import { NotAvailable, PageHeader } from "./AdminUi";
import { AdminSecurityPanel, SiteControlsPanel } from "./SiteControlsPanel";
import { SearchSignupSettingsPanel } from "./SearchSignupSettingsPanel";
import { OtpProviderPanel } from "./OtpProviderPanel";
import { OtpPolicyPanel } from "./OtpPolicyPanel";
import { PaymentProviderPanel } from "./PaymentProviderPanel";
import { MatchingWeightsPanel, OtpConfigPanel } from "./SettingsPanels";

/** `/admin/super/settings` — platform-wide configuration only a Super Admin should change. */
export function PlatformSettingsClient() {
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Platform Settings"
        icon={<Crown className="h-5 w-5 text-rz-gold-rich" strokeWidth={1.8} />}
        description="OTP delivery and policy, match scoring, payment gateway, search and sign-up for the whole platform — Super Admin only."
      />
      <OtpProviderPanel />
      <OtpPolicyPanel />
      <OtpConfigPanel />
      <MatchingWeightsPanel />
      <PaymentProviderPanel />
      <SearchSignupSettingsPanel />
      <SiteControlsPanel />
      <AdminSecurityPanel />
      <NotAvailable title="Not available">
        Per-feature flags have no backend storage, so there are no switches for them here rather than controls that would not save.
      </NotAvailable>
    </div>
  );
}
