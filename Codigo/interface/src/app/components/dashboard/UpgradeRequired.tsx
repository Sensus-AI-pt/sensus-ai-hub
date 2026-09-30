import { Lock } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { PageHeader } from "./PageHeader";
import { translations } from "./translations";
import { TIER_LABEL_KEY, type Tier } from "./tierAccess";

const PLANS_URL = "https://sensus-ai.pt/#precos";

declare global {
  interface Window {
    electronAPI?: any;
  }
}

export function UpgradeRequired({
  pageLabel,
  requiredTier,
  lang = "pt",
}: {
  pageLabel: string;
  requiredTier: Tier;
  lang?: string;
}) {
  const t = translations[lang] || translations.pt;

  const handleUpgradeClick = () => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(PLANS_URL);
    } else {
      window.open(PLANS_URL, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="relative z-10 flex flex-1 flex-col gap-6 p-4 md:p-6">
      <PageHeader title={pageLabel} subtitle={t.upgradeBody} />
      <Card className="border-border bg-card panel-shadow">
        <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <Lock size={28} />
          </div>
          <h2 className="text-foreground text-xl font-semibold">{t.upgradeTitle}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{t.upgradeBody}</p>
          <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
            {t.upgradeRequires} {t[TIER_LABEL_KEY[requiredTier]]}
          </span>
          <Button
            onClick={handleUpgradeClick}
            className="gap-2 bg-primary text-primary-foreground glow-primary hover:bg-primary/90"
          >
            {t.upgradeCta}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
