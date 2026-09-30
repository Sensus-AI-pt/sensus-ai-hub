import { useState, useEffect, useRef } from "react";
import { Sparkles, Wand2, Image as ImageIcon, RefreshCw, Info, X, Maximize2, Download, Mic, MicOff, Volume2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Slider } from "../ui/slider";
import { Input } from "../ui/input";
import { PageHeader } from "./PageHeader";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import loginBg from "../../../imports/ChatGPT_Image_13_07_2026__16_21_33.png";
import { translations } from "./translations";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";

const suggestions = [
  "Ambiente sensorial calmo com luz suave",
  "Jardim interativo com estímulos visuais",
  "Espaço de foco com tons frios",
  "Cena relaxante ao entardecer",
];

declare global {
  interface Window {
    electronAPI?: any;
  }
}

export function AssistantPage({ latestData, lang = "pt" }: { latestData?: any; lang?: string }) {
  const t = translations[lang] || translations.pt;
  const [prompt, setPrompt] = useState("Ambiente sensorial calmo com flores luminosas");
  const [creativity, setCreativity] = useState(65);
  const [cfgScale, setCfgScale] = useState(7.0);
  const [steps, setSteps] = useState(4);
  const [seed, setSeed] = useState(2252004);
  const [generating, setGenerating] = useState(false);
  const [mockImage, setMockImage] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState("Voz Bio-Ativa inativa.");
  const [voiceLogs, setVoiceLogs] = useState<string[]>([]);
  const [fullscreenImage, setFullscreenImage] = useState<boolean>(false);
  const [refImage, setRefImage] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const promptDebounceRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const handleRefImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setRefImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveRefImage = () => {
    setRefImage(null);
  };

  // Debounced prompt transmission to Python
  const handlePromptChange = (text: string) => {
    setPrompt(text);
    localStorage.setItem("sensus-active-prompt", text);
    if (promptDebounceRef.current) {
      clearTimeout(promptDebounceRef.current);
    }
    promptDebounceRef.current = setTimeout(() => {
      if (window.electronAPI) {
        window.electronAPI.sendRPPGCommand(`SET_PROMPT ${text}`);
      }
    }, 450);
  };

  const handleCreativityChange = (val: number) => {
    setCreativity(val);
    if (window.electronAPI) {
      // Map 0..100 to 0.1..0.95 denoising strength
      const denoising = (0.1 + (val / 100) * 0.85).toFixed(2);
      window.electronAPI.sendRPPGCommand(`SET_DENOISING ${denoising}`);
    }
  };

  const handleCfgScaleChange = (val: number) => {
    setCfgScale(val);
    if (window.electronAPI) {
      window.electronAPI.sendRPPGCommand(`SET_CFG ${val.toFixed(1)}`);
    }
  };

  const handleStepsChange = (val: number) => {
    setSteps(val);
    if (window.electronAPI) {
      window.electronAPI.sendRPPGCommand(`SET_STEPS ${val}`);
    }
  };

  const handleSeedChange = (val: number) => {
    setSeed(val);
    if (window.electronAPI) {
      window.electronAPI.sendRPPGCommand(`SET_SEED ${val}`);
    }
  };

  const log = (msg: string) => setVoiceLogs((prev) => [...prev, `${new Date().toLocaleTimeString("pt-PT")} — ${msg}`]);

  // ── Speech-to-Text: ditado de prompt via servidor local Speaches AI ──
  const toggleDictation = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(false);
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const base64 = await new Promise<string>((res) => {
          const r = new FileReader();
          r.onloadend = () => res(r.result as string);
          r.readAsDataURL(blob);
        });
        if (window.electronAPI?.transcribeAudio) {
          setVoiceStatus("A transcrever voz (Speaches AI)...");
          const result = await window.electronAPI.transcribeAudio(base64, "audio/webm");
          if (result.success && result.text) {
            handlePromptChange((prompt ? prompt + " " : "") + result.text);
            setVoiceStatus("Ditado inserido no prompt.");
            log("Transcrição Speaches: " + result.text);
          } else {
            setVoiceStatus(result.error || "Falha na transcrição.");
          }
        }
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
      setVoiceStatus("A gravar ditado... clique novamente para parar.");
    } catch (e: any) {
      setVoiceStatus("Microfone indisponível: " + e.message);
    }
  };

  // ── Text-to-Speech: Voz Bio-Ativa local via Piper TTS ──
  const triggerVoiceAssistant = async () => {
    setVoiceStatus("A sintetizar voz bio-ativa (Piper TTS)...");
    const estado = latestData?.dom || "estável";
    const bpm = latestData?.bpm ? Math.round(latestData.bpm) : 72;
    const text = `${prompt}. O teu batimento é ${bpm} batimentos por minuto e o teu estado é ${estado}.`;
    log("Síntese Piper TTS iniciada...");
    if (window.electronAPI?.speakText) {
      const res = await window.electronAPI.speakText(text);
      if (res.success && res.wav) {
        const audio = new Audio(res.wav);
        audio.volume = Number(localStorage.getItem("sensus.voiceVolume") ?? 0.7);
        audio.play();
        setVoiceStatus("Voz bio-ativa reproduzida (Piper TTS).");
        log("Reprodução de áudio Piper concluída.");
      } else {
        setVoiceStatus(res.error || "Piper indisponível.");
        log(res.error || "Piper indisponível.");
      }
    } else {
      setVoiceStatus("Voz Bio-Ativa indisponível em modo web.");
    }
  };

  const handleGenerateImage = async () => {
    setGenerating(true);
    if (window.electronAPI && window.electronAPI.generateSingleImage) {
      try {
        const res = await window.electronAPI.generateSingleImage({
          prompt,
          cfg: cfgScale,
          steps,
          seed,
          denoising: creativity / 100,
          refImage: refImage
        });
        if (res.success && res.image_ia) {
          setMockImage(res.image_ia);
        } else {
          console.error("Failed to generate image:", res.error);
          alert("Erro na geração da imagem: " + (res.error || "Erro desconhecido"));
        }
      } catch (err: any) {
        console.error("IPC generateSingleImage error:", err);
        alert("Erro na geração da imagem: " + err.message);
      } finally {
        setGenerating(false);
      }
    } else {
      setTimeout(() => {
        setGenerating(false);
        const presets = [
          "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=512&auto=format&fit=crop",
          "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=512&auto=format&fit=crop",
          "https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=512&auto=format&fit=crop",
          "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=512&auto=format&fit=crop",
        ];
        const randomUrl = presets[Math.floor(Math.random() * presets.length)];
        setMockImage(randomUrl);
      }, 1500);
    }
  };

  const handleDownloadImage = async () => {
    if (!imgSrc) return;
    
    let base64Data = imgSrc;
    
    // If the image is a URL (like unsplash mock images), convert it to base64 first
    if (imgSrc.startsWith("http")) {
      try {
        const response = await fetch(imgSrc);
        const blob = await response.blob();
        const reader = new FileReader();
        base64Data = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (err: any) {
        console.error("Error fetching image URL:", err);
        alert("Erro ao processar imagem para download: " + err.message);
        return;
      }
    }

    if (window.electronAPI && window.electronAPI.writeBinaryFile) {
      try {
        const defaultName = `imagem_sensus_${Date.now()}.jpg`;
        const saveResult = await window.electronAPI.showSaveDialog({
          title: "Guardar Imagem Gerada",
          defaultPath: defaultName,
          filters: [
            { name: "Imagens JPEG", extensions: ["jpg", "jpeg"] },
            { name: "Imagens PNG", extensions: ["png"] }
          ],
        });

        if (saveResult && !saveResult.canceled && saveResult.filePath) {
          const writeRes = await window.electronAPI.writeBinaryFile(saveResult.filePath, base64Data);
          if (writeRes.success) {
            alert(`Imagem guardada com sucesso em:\n${saveResult.filePath}`);
          } else {
            alert(`Erro ao guardar imagem: ${writeRes.error}`);
          }
        }
      } catch (err: any) {
        console.error(err);
        alert("Erro ao tentar guardar o ficheiro: " + err.message);
      }
    } else {
      // Browser fallback
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", base64Data);
      downloadAnchor.setAttribute("download", `imagem_sensus_${Date.now()}.jpg`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    }
  };

  // O resultado da geração única nunca pode ser mascarado pelo stream ao vivo
  // do Ambiente Virtual (que também escreve em latestData.image_ia).
  const imgSrc = mockImage || latestData?.image_ia || loginBg;

  return (
    <div className="relative z-10 flex flex-1 flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title={t.aiAssistant}
        subtitle="Gere ambientes visuais a partir de prompts de texto e biofeedback"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Prompt panel */}
        <Card className="border-border bg-card panel-shadow">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Wand2 className="size-4" />
            </div>
            <CardTitle className="text-foreground">Prompt de Geração</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="relative">
              <Textarea
                value={prompt}
                onChange={(e) => handlePromptChange(e.target.value)}
                rows={3}
                placeholder="Descreva o ambiente que pretende gerar..."
                className="resize-none border-border bg-secondary pr-12"
              />
              <button
                type="button"
                onClick={toggleDictation}
                title={recording ? "Parar ditado" : "Ditar prompt por voz (Speaches AI)"}
                className={`absolute right-2 top-2 flex size-8 items-center justify-center rounded-lg border transition-colors ${
                  recording
                    ? "bg-red-500/20 text-red-400 border-red-500/40 mov-respira"
                    : "bg-secondary/60 text-muted-foreground border-border hover:text-primary hover:border-primary/40"
                }`}
              >
                {recording ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </button>
            </div>

            {/* Imagem de Referência (Opcional) */}
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground font-semibold">
                Imagem de Referência (Opcional)
              </span>
              {refImage ? (
                <div className="relative group rounded-xl border border-border bg-secondary/30 p-2 flex items-center gap-3">
                  <img src={refImage} className="size-12 rounded-lg object-cover border border-border" alt="Referência" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-foreground font-medium truncate">Imagem carregada</p>
                    <p className="text-[9px] text-muted-foreground">Será combinada com o prompt</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveRefImage}
                    className="absolute right-2 top-1/2 -translate-y-1/2 flex size-6 items-center justify-center rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:text-white transition-colors"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center border border-dashed border-border/80 bg-secondary/20 hover:bg-secondary/40 rounded-xl p-3 cursor-pointer transition-colors text-center gap-1 group">
                  <ImageIcon className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  <span className="text-[11px] text-muted-foreground font-medium group-hover:text-foreground transition-colors">
                    Carregar Imagem de Referência
                  </span>
                  <span className="text-[9px] text-muted-foreground/60">
                    PNG, JPG ou JPEG até 5MB
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleRefImageChange}
                  />
                </label>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Creativity (Denoising)</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="size-3.5 text-muted-foreground hover:text-cyan cursor-help transition-colors" />
                      </TooltipTrigger>
                      <TooltipContent className="border border-border bg-card text-foreground max-w-xs p-2.5">
                        Controla a intensidade da alteração da imagem de base. Valores mais altos permitem que o modelo se afaste mais da imagem original para maior criatividade (denoising strength).
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <span className="text-xs text-cyan glow-text-cyan">{creativity}%</span>
                </div>
                <Slider
                  value={[creativity]}
                  max={100}
                  step={1}
                  onValueChange={(v) => handleCreativityChange(v[0])}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">CFG Scale</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="size-3.5 text-muted-foreground hover:text-cyan cursor-help transition-colors" />
                      </TooltipTrigger>
                      <TooltipContent className="border border-border bg-card text-foreground max-w-xs p-2.5">
                        Classifier-Free Guidance. Controla o quão fiel a imagem gerada deve ser ao prompt textual. Valores maiores forçam uma correspondência mais estrita ao prompt.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <span className="text-xs text-cyan glow-text-cyan">{cfgScale}</span>
                </div>
                <Slider
                  value={[cfgScale]}
                  min={1.0}
                  max={15.0}
                  step={0.1}
                  onValueChange={(v) => handleCfgScaleChange(v[0])}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Steps</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="size-3.5 text-muted-foreground hover:text-cyan cursor-help transition-colors" />
                      </TooltipTrigger>
                      <TooltipContent className="border border-border bg-card text-foreground max-w-xs p-2.5">
                        Número de passos de difusão de imagem. Mais passos aumentam o detalhe visual, mas exigem mais tempo de processamento.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <span className="text-xs text-cyan glow-text-cyan">{steps}</span>
                </div>
                <Slider
                  value={[steps]}
                  min={1}
                  max={10}
                  step={1}
                  onValueChange={(v) => handleStepsChange(v[0])}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Seed</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="size-3.5 text-muted-foreground hover:text-cyan cursor-help transition-colors" />
                    </TooltipTrigger>
                    <TooltipContent className="border border-border bg-card text-foreground max-w-xs p-2.5">
                      Semente de inicialização aleatória. Fixar a semente permite obter resultados visuais idênticos e consistentes com o mesmo prompt.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  type="number"
                  value={seed}
                  onChange={(e) => handleSeedChange(Number(e.target.value))}
                  className="h-8 border-border bg-secondary text-xs"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">Sugestões</span>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handlePromptChange(s)}
                    className="rounded-full border border-border bg-secondary px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-3 mt-2">
              <Button
                onClick={handleGenerateImage}
                disabled={generating}
                className="gap-2 bg-cyan text-black glow-cyan hover:bg-cyan/95"
              >
                {generating ? <RefreshCw className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                {lang === "en" ? "Generate" : lang === "es" ? "Generar" : lang === "fr" ? "Générer" : "Gerar Imagem"}
              </Button>
              <Button
                onClick={triggerVoiceAssistant}
                className="gap-2 bg-primary text-primary-foreground glow-primary hover:bg-primary/90"
              >
                <Volume2 className="size-4" />
                {lang === "en" ? "Read Prompt" : lang === "es" ? "Leer Prompt" : lang === "fr" ? "Lire le Prompt" : "Ler Prompt"}
              </Button>
            </div>

            <div className="mt-2 rounded-xl border border-border bg-secondary/30 p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="mov-respira size-2 rounded-full bg-cyan glow-cyan" />
                <span className="text-xs text-foreground font-semibold">{voiceStatus}</span>
              </div>
              {voiceLogs.length > 0 && (
                <div className="flex flex-col gap-1 max-h-24 overflow-y-auto border-t border-border/30 pt-2 font-mono text-[10px] text-muted-foreground pr-1">
                  {voiceLogs.map((log, idx) => (
                    <div key={idx} className="truncate">{log}</div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Result panel */}
        <Card className="border-border bg-card panel-shadow self-start">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <div className="flex size-8 items-center justify-center rounded-lg bg-cyan/15 text-cyan">
              <ImageIcon className="size-4" />
            </div>
            <CardTitle className="text-foreground">Imagem Gerada (Stable Diffusion)</CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border group/img">
              {generating && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 backdrop-blur-sm z-10">
                  <RefreshCw className="size-8 text-cyan animate-spin" />
                  <span className="text-xs text-muted-foreground mt-2">A processar prompt no Stable Diffusion...</span>
                </div>
              )}

              {/* Overlay Action Buttons */}
              <div className="absolute right-3 top-3 z-10 flex gap-2 opacity-0 group-hover/img:opacity-100 transition-opacity duration-200">
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={() => setFullscreenImage(true)}
                  className="size-8 rounded-lg bg-background/60 text-foreground hover:bg-background/90 backdrop-blur-md border border-white/10"
                  title="Ver em Ecrã Inteiro"
                >
                  <Maximize2 className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={handleDownloadImage}
                  className="size-8 rounded-lg bg-background/60 text-foreground hover:bg-background/90 backdrop-blur-md border border-white/10"
                  title="Descarregar Imagem"
                >
                  <Download className="size-4" />
                </Button>
              </div>

              <ImageWithFallback
                src={imgSrc}
                alt="Ambiente sensorial gerado"
                className={`size-full object-cover transition-all duration-500`}
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 to-transparent p-4">
                <p className="text-sm text-foreground">{prompt}</p>
                {latestData && (
                  <span className="text-xs text-cyan mt-1 block">
                    Batimento: {latestData.bpm > 0 ? `${Math.round(latestData.bpm)} BPM` : "a calibrar..."} · Estado: {latestData.dom}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Fullscreen Visual Modal */}
      {fullscreenImage && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md cursor-zoom-out animate-in fade-in zoom-in duration-200"
          onClick={() => setFullscreenImage(false)}
        >
          <img src={imgSrc} alt="Ambiente sensorial gerado em ecrã inteiro" className="max-w-[95vw] max-h-[95vh] rounded-xl object-contain shadow-2xl" />
          <button 
            onClick={() => setFullscreenImage(false)} 
            className="absolute top-4 right-4 rounded-xl p-2.5 bg-secondary/80 text-foreground hover:bg-secondary border border-border shadow-md transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}
