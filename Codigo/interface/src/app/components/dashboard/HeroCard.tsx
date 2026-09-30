import { Sparkles } from "lucide-react";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import heroImg from "../../../imports/ChatGPT_Image_13_07_2026__16_21_33.png";

export function HeroCard({ latestData }: { latestData: any }) {
  // Use live AI generated image if available, fallback to mock image
  const imgSrc = latestData?.image_ia || heroImg;

  return (
    <div className="relative h-full min-h-56 overflow-hidden rounded-xl border border-border">
      <ImageWithFallback
        src={imgSrc}
        alt="Ambiente sensorial sensus AI"
        className="absolute inset-0 size-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-br from-[#121528]/90 via-[#121528]/40 to-primary/30" />
      <div className="relative flex h-full flex-col justify-between p-6">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/80 backdrop-blur">
            <Sparkles className="size-4 text-white" />
          </div>
          <span className="text-white">sensus AI</span>
        </div>
        <div>
          <h3 className="text-white">Inteligência Sensorial Ativa</h3>
          <p className="mt-1 max-w-md text-sm text-white/70">
            Monitorização emocional contínua com análise preditiva em tempo real.
          </p>

          <div className="mt-4 flex gap-6">
            {[
              { k: latestData ? `${latestData.fps || 15} FPS` : "24", v: latestData ? "Taxa Real" : "Sessões", positive: false },
              { k: latestData ? (latestData.bpm > 0 ? `${Math.round(latestData.bpm)}` : "—") : "12/15", v: latestData ? "BPM rPPG" : "Dispositivos", positive: false },
              { k: latestData ? `${Math.round(latestData.sym * 100)}%` : "98%", v: latestData ? "Simetria" : "Precisão", positive: false },
              { k: latestData ? latestData.dom : "Ótimo", v: "Estado", positive: true },
            ].map((s) => (
              <div key={s.v}>
                <div
                  className={s.positive ? "text-positive glow-text-positive" : "text-white"}
                  style={{ fontSize: "1.25rem", fontWeight: 600 }}
                >
                  {s.k}
                </div>
                <div className="text-xs text-white/60">{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
