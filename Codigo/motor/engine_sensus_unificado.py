#!/usr/bin/env python3
"""
Sensus AI — Engine Unificada (Biometria + StreamDiffusion + Áudio)
==================================================================
Captura a câmara do telemóvel via scrcpy-client (protocolo direto, sem janela), calcula biometria em tempo real
(FaceMesh, Action Units, Valence/Arousal, rPPG/BPM) e gera imagens via
StreamDiffusion aceleradas por GPU. A síntese de voz é local, pelo Piper TTS.
"""

import sys
import os
import time
import math
import traceback

# Force-inject virtualenv standard library and site-packages to bypass Windows path encoding issues
script_dir = os.path.dirname(os.path.abspath(__file__))
possible_paths = [
    os.path.join(script_dir, "rppg_env", "Lib", "site-packages"),
    os.path.join(script_dir, "rppg_env", "Lib"),
    os.path.join(os.path.dirname(os.path.dirname(script_dir)), "rppg_env", "Lib", "site-packages"),
    os.path.join(os.path.dirname(os.path.dirname(script_dir)), "rppg_env", "Lib"),
]
for p in possible_paths:
    if os.path.exists(p) and p not in sys.path:
        sys.path.insert(0, p)

# Force-inject DLL search directory for torch / CUDA libs
try:
    import torch
    torch_lib = os.path.join(os.path.dirname(torch.__file__), "lib")
    if os.path.exists(torch_lib):
        os.add_dll_directory(torch_lib)
except Exception:
    pass


# Carregar .env manualmente se existir
for env_path in [os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"), os.path.join(os.getcwd(), ".env")]:
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    if "=" in line and not line.strip().startswith("#"):
                        k, v = line.strip().split("=", 1)
                        os.environ[k.strip()] = v.strip()
        except Exception:
            pass

# Configuracoes offline do HuggingFace e diretorio de cache local do modelo
os.environ["HF_HOME"] = os.path.join(script_dir, "hf_cache")
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

#  & SYSTEM PATHS (Antes de importar diffusers)
# ═══════════════════════════════════════════════════════════
try:
    import huggingface_hub.constants
    if not hasattr(huggingface_hub.constants, 'hf_cache_home'):
        huggingface_hub.constants.hf_cache_home = huggingface_hub.constants.HF_HOME
except ImportError:
    pass

# Prepend do diretório de código-fonte do StreamDiffusion
sys.path.insert(0, os.path.join(script_dir, "vendor", "streamdiffusion_src"))

def _ensure_ascii_mediapipe_path():
    """Contorna a falha do MediaPipe em caminhos com caracteres nao-ASCII.

    A camada nativa em C++ do MediaPipe resolve os ficheiros de modelo
    (.binarypb/.tflite) pela API ANSI do Windows. Num caminho com acentos
    (ex.: C:\\Users\\<nome com acento>) os bytes UTF-8 chegam mal
    descodificados e o carregamento falha com FileNotFoundError, mesmo com o
    ficheiro presente no disco (os.path.exists devolve True).

    Prepender a forma curta 8.3 do diretorio que contem o pacote faz com que
    mediapipe.__file__ passe a ser ASCII e os modelos sejam encontrados.
    Se o volume tiver os nomes 8.3 desativados, nao ha conversao possivel e a
    funcao nao faz nada — nesse caso a app tem de correr de um caminho ASCII.
    """
    if sys.platform != "win32":
        return
    try:
        import ctypes
        import importlib.util
        spec = importlib.util.find_spec("mediapipe")
        if spec is None or not spec.origin:
            return
        pkg_parent = os.path.dirname(os.path.dirname(spec.origin))
        if pkg_parent.isascii():
            return
        buf = ctypes.create_unicode_buffer(32768)
        if ctypes.windll.kernel32.GetShortPathNameW(pkg_parent, buf, len(buf)) and buf.value.isascii():
            sys.path.insert(0, buf.value)
            print(f"[Sensus AI] Caminho nao-ASCII detetado; MediaPipe a usar {buf.value}", file=sys.stderr)
    except Exception as ex:
        print(f"[Sensus AI] Aviso: nao foi possivel normalizar o caminho do MediaPipe: {ex}", file=sys.stderr)


_ensure_ascii_mediapipe_path()

import cv2
import numpy as np
import mediapipe as mp
from collections import deque
import subprocess
import json
import base64
import node_graph
import threading
from PIL import Image

try:
    from scipy.signal import welch
    from unsupervised_methods.methods.POS_WANG import POS_WANG
    RPPG_AVAILABLE = True
except ImportError:
    RPPG_AVAILABLE = False
    print("[AVISO] scipy ou POS_WANG não disponíveis — rPPG desativado.", file=sys.stderr)

# Cadeado partilhado por TODOS os imports E carregamentos de modelos da
# Hugging Face (`transformers`, `diffusers`). Nada disto é seguro entre threads,
# de duas formas distintas:
#
# 1. **Import.** Os submódulos resolvem-se de forma preguiçosa
#    (`_LazyModule.__getattr__`). Com dois carregamentos ao mesmo tempo, um vê o
#    pacote a meio da inicialização e rebenta com
#      ImportError: cannot import name 'CLIPImageProcessor' from 'transformers'
#    que o `diffusers` depois embrulha num RuntimeError.
#
# 2. **Construção do modelo.** O `accelerate.init_empty_weights` substitui o
#    `nn.Module.register_parameter` **do processo inteiro** enquanto constrói o
#    modelo no dispositivo `meta`. Um modelo criado noutra thread durante essa
#    janela nasce em `meta` sem lá dever estar, e o `.to("cuda")` seguinte falha
#    com "Cannot copy out of meta tensor; no data!".
#
# Três consumidores concorrentes: Whisper (voz), Depth Anything (profundidade) e
# StreamDiffusion (geração). Sem o cadeado, um deles falhava — qual, era à sorte.
# Reproduzido na Regulação Sensorial ligando o overlay de profundidade a seguir
# ao LOAD_EXHIBITION: a geração de imagem morria e não voltava.
#
# Custo: quem pedir o modelo de profundidade enquanto o StreamDiffusion arranca
# espera por ele (~25 s medidos no pacote). É de propósito — um modelo partido ao
# calhas é pior do que um arranque em fila.
_HF_LOCK = threading.Lock()

# Import do StreamDiffusion diferido: custa ~20 s (diffusers/controlnet_aux) e bloqueava
# a câmara no arranque. A câmara/telemetria arrancam primeiro; a geração ativa-se depois.
load_config = None
create_wrapper_from_config = None

def _import_streamdiffusion():
    global load_config, create_wrapper_from_config
    if create_wrapper_from_config is not None:
        return True
    try:
        with _HF_LOCK:
            from streamdiffusion.config import load_config as _lc, create_wrapper_from_config as _cw
        load_config, create_wrapper_from_config = _lc, _cw
        return True
    except Exception as e:
        # `except ImportError` não chegava: o `diffusers` converte a falha do
        # import preguiçoso num RuntimeError, que escapava daqui, escapava do
        # `_load_sd_background` e matava a thread de geração em silêncio — o
        # `sd_status` ficava em "loading" para sempre e a interface mostrava
        # "Motor IA a carregar" sem fim.
        print(f"[AVISO] StreamDiffusion não disponível: {e}", file=sys.stderr)
        return False

# ═══════════════════════════════════════════════════════════
# CONSTANTES — Índices de landmarks MediaPipe (468 pontos)
# ═══════════════════════════════════════════════════════════
LEFT_EYE_OUTER      = 33
LEFT_EYE_INNER      = 133
RIGHT_EYE_INNER     = 362
RIGHT_EYE_OUTER     = 263

LEFT_EYEBROW_INNER  = 55
LEFT_EYEBROW_OUTER  = 70
RIGHT_EYEBROW_INNER = 285
RIGHT_EYEBROW_OUTER = 300

NOSE_BRIDGE = 6
NOSE_TIP    = 1

MOUTH_LEFT       = 61
MOUTH_RIGHT      = 291
MOUTH_TOP_LIP    = 13
MOUTH_BOTTOM_LIP = 14

CHIN     = 152
FOREHEAD = 10

# EAR landmarks (modelo simplificado de 4 pontos)
L_EY = {"top": 159, "bottom": 145, "outer": 33,  "inner": 133}
R_EY = {"top": 386, "bottom": 374, "outer": 263, "inner": 362}

# Landmarks adicionais para AUs
LEFT_CHEEK_TOP  = 117
RIGHT_CHEEK_TOP = 346
NOSE_SIDE_L     = 48
NOSE_SIDE_R     = 278
UPPER_LIP       = 0
LOWER_LIP       = 17

active_sensors = {"rppg": True, "gaze": True, "blink": True, "symmetry": True,
                  "flow": True, "presence": True, "gesture": False}

# ═══════════════════════════════════════════════════════════
# MOTOR DE SÍNTESE SONORA GENERATIVA MULTICAMADA (5 CAMADAS)
# Porta em tempo real do motor Tone.js de "generative-mood-music".
# Camadas independentes: Melodia · Piano (acordes/sustain) · Coro (pad)
#                        · Tabla · Percussão (bumbo + pratos)
# ═══════════════════════════════════════════════════════════
SAMPLE_RATE = 44100
BLOCK_SIZE = 1024

try:
    from scipy.signal import lfilter as _lfilter
    _FILTERS_OK = True
except Exception:
    _FILTERS_OK = False

# Estado biométrico partilhado — eixos dimensionais de Russell.
# Inicializado no topo ABSOLUTO do script com as chaves dimensionais a 0.0
# para prevenir crashes de KeyError quando nenhum rosto é detetado no frame inicial.
smoothed = {
    "bpm": 72.0, "val": 0.0, "aro": 0.0, "sym": 0.5,
    "positivo": 0.0, "negativo": 0.0, "ativado": 0.0, "nao_ativado": 1.0,
    "iris": 0.0,
}

# Sintetizador global
synth_base_f0 = 130.81   # C3
synth_timbre = 0.5       # mantido por compatibilidade com comandos stdin antigos
synth_volume = 0.6
synth_active = True       # o som inicializa SEMPRE ATIVO (unmuted) por defeito

# Upscale da imagem gerada, feito na GPU sem sair da VRAM (ver _upscale_gpu).
# fator 1.0 = desligado, que é o valor de fábrica: ampliar obriga a codificar um
# JPEG maior no ciclo principal e isso custa FPS mesmo quando o upscale é grátis.
upscale_cfg = {"fator": 1.0, "nitidez": 0.35}

# Espelho da câmara, comum a todos os ambientes que consomem o feed do motor
# (Regulação Sensorial e Depth Map Tools; o Air Painting tem o seu próprio, que
# atua sobre a tela composta, e o Fluid AI espelha no shader do frontend).
# Dicionário e não variável solta para o comando stdin não precisar de `global`.
camera_mirror = {"on": True}

# Ganho (0..1) e estado ligado/desligado de cada uma das 5 camadas independentes
audio_layers = {
    "melodia":   {"vol": 0.85, "on": True},
    "piano":     {"vol": 0.70, "on": True},
    "coro":      {"vol": 0.55, "on": True},
    "tabla":     {"vol": 0.50, "on": True},
    "percussao": {"vol": 0.45, "on": True},
}

# Aliases aceites nos comandos stdin (SET_VOLUME_<X> / TOGGLE_<X>)
_LAYER_ALIASES = {
    "melodia": "melodia", "melody": "melodia",
    "piano": "piano",
    "coro": "coro", "choir": "coro",
    "tabla": "tabla",
    "percussao": "percussao", "perc": "percussao", "percussion": "percussao",
}

# Override compensatório (homeostase) proveniente da análise vocal (secção 3).
# force_scale força uma escala; bpm_mult/cutoff_mult reduzem andamento e abertura;
# mute_perc silencia camadas rítmicas para induzir relaxamento profundo.
compensatory = {"force_scale": None, "bpm_mult": 1.0, "cutoff_mult": 1.0, "mute_perc": False}

# Controlo manual do utilizador sobre o motor generativo (painel do ambiente virtual).
# scale=None → escolha automática pela valência; bpm_mult/cutoff_mult multiplicam o
# andamento e a abertura do filtro. A homeostase (compensatory) mantém prioridade.
user_music = {"scale": None, "bpm_mult": 1.0, "cutoff_mult": 1.0}

# Estado atual do motor musical (emitido na telemetria — a UI mostra a regulação
# emocional a acontecer em tempo real: BPM/escala/densidade/filtro reativos).
music_state = {"bpm": 0, "scale": "", "density": 0.0, "cutoff": 0, "genre": ""}

# Espectro (3 bandas) do áudio GERADO (mistura das 5 camadas), calculado no
# callback de áudio — usado pelo node `audio_spectrum`. Não é uma medição
# calibrada, é uma estimativa de energia relativa por banda (RMS do FFT).
audio_spectrum_state = {"bass": 0.0, "mid": 0.0, "treble": 0.0}

def _update_audio_spectrum(mix):
    n = len(mix)
    if n == 0:
        return
    spectrum = np.abs(np.fft.rfft(mix * np.hanning(n)))
    freqs = np.fft.rfftfreq(n, d=1.0 / SAMPLE_RATE)
    def band(lo, hi):
        idx = np.where((freqs >= lo) & (freqs < hi))[0]
        return float(np.sqrt(np.mean(spectrum[idx] ** 2))) / 20.0 if len(idx) else 0.0
    audio_spectrum_state["bass"] = min(1.0, band(20, 250))
    audio_spectrum_state["mid"] = min(1.0, band(250, 2000))
    audio_spectrum_state["treble"] = min(1.0, band(2000, 16000))

# Última nota gerada pela camada de Melodia (consumida pela pauta da janela de projeção)
last_melody_note = {"name": "", "id": 0}

# ═══════════════════════════════════════════════════════════
# ESCALAS E ACORDES
# ═══════════════════════════════════════════════════════════
# Offsets em semitons a partir da tónica. Eram três escalas (menor, pentatónica
# maior, lídio) e por isso a peça tinha três cores harmónicas no total: ao fim de
# alguns minutos ouvia-se sempre o mesmo material. Cada género escolhe agora o
# seu trio dentro desta lista.
_SCALES = {
    "minor":          [0, 2, 3, 5, 7, 8, 10, 12, 15],
    "major_pent":     [0, 2, 4, 7, 9, 12, 14, 16],
    "lydian":         [0, 2, 4, 6, 7, 9, 11, 12, 16],
    "major":          [0, 2, 4, 5, 7, 9, 11, 12, 16],
    "dorian":         [0, 2, 3, 5, 7, 9, 10, 12, 14],
    "phrygian":       [0, 1, 3, 5, 7, 8, 10, 12, 13],
    "mixolydian":     [0, 2, 4, 5, 7, 9, 10, 12, 16],
    "harmonic_minor": [0, 2, 3, 5, 7, 8, 11, 12, 15],
    "minor_pent":     [0, 3, 5, 7, 10, 12, 15, 17],
    "blues":          [0, 3, 5, 6, 7, 10, 12, 15],
    "hirajoshi":      [0, 2, 3, 7, 8, 12, 14, 15],
    "pelog":          [0, 1, 3, 7, 8, 12, 13, 15],
    "whole_tone":     [0, 2, 4, 6, 8, 10, 12, 14],
}
_CHORDS = {
    "minor":          [0, 3, 7, 10],
    "major_pent":     [0, 4, 7, 9],
    "lydian":         [0, 4, 7, 11],
    "major":          [0, 4, 7, 11],
    "dorian":         [0, 3, 7, 9],
    "phrygian":       [0, 3, 7, 8],
    "mixolydian":     [0, 4, 7, 10],
    "harmonic_minor": [0, 3, 7, 11],
    "minor_pent":     [0, 3, 7, 10],
    "blues":          [0, 3, 6, 10],
    "hirajoshi":      [0, 2, 7, 8],
    "pelog":          [0, 3, 7, 8],
    "whole_tone":     [0, 4, 8, 10],
}
_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

def _semitone_to_freq(base_f0, semis):
    return base_f0 * (2.0 ** (semis / 12.0))

def _freq_to_name(freq):
    if freq <= 0:
        return ""
    midi = int(round(69 + 12 * math.log2(freq / 440.0)))
    return f"{_NOTE_NAMES[midi % 12]}{midi // 12 - 1}"


# ═══════════════════════════════════════════════════════════
# INSTRUMENTOS
# ═══════════════════════════════════════════════════════════
# Cada classe é um timbre, sintetizado por bloco. Todas as vozes melódicas
# expõem `decay` — é a cauda da nota, o parâmetro que o estado medido controla
# (ver `_spawn_step`), e é por ela que o `test_musica.py` mede a articulação.
# Todas continuam a ser matemática sobre `t`: não há samples em disco, o que
# mantém a peça a arrancar sem ficheiros de áudio e o som sempre disponível.

class _Voice:
    """Oscilador tonal com envelope attack + decay exponencial."""
    __slots__ = ("freq", "amp", "wave", "phase", "n", "attack_n", "decay", "alive")

    def __init__(self, freq, amp, wave="sine", attack=0.01, decay=1.2):
        self.freq = freq
        self.amp = amp
        self.wave = wave
        self.phase = 0.0
        self.n = 0
        self.attack_n = max(1, int(attack * SAMPLE_RATE))
        self.decay = decay
        self.alive = True

    def render(self, block):
        idx = np.arange(block)
        local = self.n + idx
        ph = self.phase + 2 * np.pi * self.freq * (idx / SAMPLE_RATE)
        self.phase = (self.phase + 2 * np.pi * self.freq * block / SAMPLE_RATE) % (2 * np.pi)
        if self.wave == "triangle":
            sig = (2.0 / np.pi) * np.arcsin(np.sin(ph))
        elif self.wave == "saw":
            sig = 2.0 * ((self.freq * local / SAMPLE_RATE) % 1.0) - 1.0
        else:
            sig = np.sin(ph)
        att = np.clip(local / self.attack_n, 0.0, 1.0)
        dect = np.clip((local - self.attack_n) / SAMPLE_RATE, 0.0, None)
        env = att * np.exp(-dect / self.decay)
        self.n += block
        if env[-1] < 0.003 and local[-1] > self.attack_n:
            self.alive = False
        return sig * env * self.amp


class _NoiseVoice:
    """Ruído com decay curto e cor ajustável — prato, hi-hat, shaker, escova.

    `cor` inclina o espectro sem custar um filtro a sério: positivo aplica
    diferenças sucessivas (+6 dB/oitava cada — brilhante, shaker), negativo
    aplica médias de dois pontos (escuro, escova sobre a pele). É uma inclinação
    grosseira e não um filtro projetado; chega para os timbres se distinguirem à
    distância de uma sala, que é o requisito.
    """
    __slots__ = ("amp", "n", "decay", "passes", "escuro", "alive")

    def __init__(self, amp, decay=0.05, cor=0.0):
        self.amp = amp
        self.n = 0
        self.decay = decay
        self.passes = min(3, int(round(abs(cor) * 3)))
        self.escuro = cor < 0
        self.alive = True

    def render(self, block):
        local = self.n + np.arange(block)
        env = np.exp(-(local / SAMPLE_RATE) / self.decay)
        self.n += block
        if env[-1] < 0.003:
            self.alive = False
        x = np.random.uniform(-1.0, 1.0, block)
        for _ in range(self.passes):
            # Descontinuidade de uma amostra na fronteira do bloco: inaudível
            # numa rajada de ruído, e poupa guardar estado por voz.
            anterior = np.concatenate(([0.0], x[:-1]))
            x = (x + anterior) * 0.7 if self.escuro else (x - anterior) * 0.6
        return x * env * self.amp


class _KickVoice:
    """Bumbo: sweep de frequência descendente até `tune`."""
    __slots__ = ("amp", "n", "phase", "tune", "decay", "alive")

    def __init__(self, amp, tune=40.0, decay=0.18):
        self.amp = amp
        self.n = 0
        self.phase = 0.0
        self.tune = tune
        self.decay = decay
        self.alive = True

    def render(self, block):
        t = (self.n + np.arange(block)) / SAMPLE_RATE
        freq = self.tune + 80.0 * np.exp(-t / 0.03)
        ph = self.phase + 2 * np.pi * np.cumsum(freq) / SAMPLE_RATE
        self.phase = ph[-1] % (2 * np.pi)
        env = np.exp(-t / self.decay)
        self.n += block
        if env[-1] < 0.003:
            self.alive = False
        return np.sin(ph) * env * self.amp


class _SnareVoice:
    """Tarola: corpo tonal curto por baixo de um rufo de ruído."""
    __slots__ = ("amp", "n", "alive")

    def __init__(self, amp):
        self.amp = amp
        self.n = 0
        self.alive = True

    def render(self, block):
        t = (self.n + np.arange(block)) / SAMPLE_RATE
        corpo = np.sin(2 * np.pi * 185.0 * t) * np.exp(-t / 0.05)
        ruido = np.random.uniform(-1.0, 1.0, block) * np.exp(-t / 0.10)
        env = np.exp(-t / 0.13)
        self.n += block
        if env[-1] < 0.003:
            self.alive = False
        return (0.5 * corpo + 0.7 * ruido) * env * self.amp


class _ClapVoice:
    """Palma: três rajadas muito curtas seguidas de uma cauda de sala."""
    __slots__ = ("amp", "n", "alive")

    def __init__(self, amp):
        self.amp = amp
        self.n = 0
        self.alive = True

    def render(self, block):
        t = (self.n + np.arange(block)) / SAMPLE_RATE
        env = 0.35 * np.exp(-t / 0.22)
        for atraso in (0.0, 0.011, 0.023):
            d = t - atraso
            env = env + np.where(d >= 0.0, np.exp(-np.clip(d, 0.0, None) / 0.008), 0.0)
        self.n += block
        if env[-1] < 0.003:
            self.alive = False
        return np.random.uniform(-1.0, 1.0, block) * env * self.amp


class _TablaVoice:
    """Membrana percussiva afinada com breve queda de pitch."""
    __slots__ = ("amp", "base", "n", "phase", "alive")

    def __init__(self, amp, base=180.0):
        self.amp = amp
        self.base = base
        self.n = 0
        self.phase = 0.0
        self.alive = True

    def render(self, block):
        t = (self.n + np.arange(block)) / SAMPLE_RATE
        freq = self.base * (1.0 + 2.0 * np.exp(-t / 0.01))
        ph = self.phase + 2 * np.pi * np.cumsum(freq) / SAMPLE_RATE
        self.phase = ph[-1] % (2 * np.pi)
        env = np.exp(-t / 0.12)
        self.n += block
        if env[-1] < 0.003:
            self.alive = False
        return np.sin(ph) * env * self.amp


class _PluckVoice:
    """Corda dedilhada: parciais harmónicos com brilho inicial e decay curto."""
    __slots__ = ("freq", "amp", "n", "decay", "alive")

    def __init__(self, freq, amp, decay=0.30):
        self.freq = freq
        self.amp = amp
        self.n = 0
        self.decay = decay
        self.alive = True

    def render(self, block):
        t = (self.n + np.arange(block)) / SAMPLE_RATE
        env = np.exp(-t / self.decay)
        sig = (np.sin(2 * np.pi * self.freq * t)
               + 0.5 * np.sin(2 * np.pi * self.freq * 2 * t) * np.exp(-t / 0.08)
               + 0.25 * np.sin(2 * np.pi * self.freq * 3 * t) * np.exp(-t / 0.05))
        self.n += block
        if env[-1] < 0.003:
            self.alive = False
        return sig * env * self.amp


class _BellVoice:
    """Sino: portadora + parcial inarmónico (razão 2.76) com decay longo."""
    __slots__ = ("freq", "amp", "n", "decay", "alive")

    def __init__(self, freq, amp, decay=1.8):
        self.freq = freq
        self.amp = amp
        self.n = 0
        self.decay = decay
        self.alive = True

    def render(self, block):
        t = (self.n + np.arange(block)) / SAMPLE_RATE
        env = np.exp(-t / self.decay)
        sig = (np.sin(2 * np.pi * self.freq * t)
               + 0.4 * np.sin(2 * np.pi * self.freq * 2.76 * t) * np.exp(-t / (self.decay * 0.5)))
        self.n += block
        if env[-1] < 0.003:
            self.alive = False
        return sig * env * self.amp


class _MarimbaVoice:
    """Marimba/metalofone: fundamental com parciais de barra (4× e 9.2×)."""
    __slots__ = ("freq", "amp", "n", "decay", "alive")

    def __init__(self, freq, amp, decay=0.42):
        self.freq = freq
        self.amp = amp
        self.n = 0
        self.decay = decay
        self.alive = True

    def render(self, block):
        t = (self.n + np.arange(block)) / SAMPLE_RATE
        sig = (np.sin(2 * np.pi * self.freq * t)
               + 0.35 * np.sin(2 * np.pi * self.freq * 4.0 * t) * np.exp(-t / 0.06)
               + 0.12 * np.sin(2 * np.pi * self.freq * 9.2 * t) * np.exp(-t / 0.02))
        env = np.exp(-t / self.decay)
        self.n += block
        if env[-1] < 0.003:
            self.alive = False
        return sig * env * self.amp


class _OrganVoice:
    """Órgão: drawbars harmónicos, ataque rápido, sustentação e corte.

    `decay` é aqui o tempo de sustentação: a nota mantém-se e só depois cai. É o
    inverso da lógica das outras vozes e é o que faz o órgão soar a órgão.
    """
    __slots__ = ("freq", "amp", "n", "decay", "alive")
    _DRAWBARS = ((1.0, 1.0), (2.0, 0.5), (3.0, 0.32), (4.0, 0.22))

    def __init__(self, freq, amp, decay=1.2):
        self.freq = freq
        self.amp = amp
        self.n = 0
        self.decay = decay
        self.alive = True

    def render(self, block):
        t = (self.n + np.arange(block)) / SAMPLE_RATE
        sig = np.zeros(block)
        for k, g in self._DRAWBARS:
            if self.freq * k < SAMPLE_RATE * 0.45:
                sig += g * np.sin(2 * np.pi * self.freq * k * t)
        env = np.clip(t / 0.03, 0.0, 1.0) * np.exp(-np.clip(t - self.decay, 0.0, None) / 0.12)
        self.n += block
        if env[-1] < 0.003:
            self.alive = False
        return sig * env * self.amp


class _FluteVoice:
    """Sopro: seno com vibrato e um sopro de ruído no ataque."""
    __slots__ = ("freq", "amp", "n", "decay", "alive")

    def __init__(self, freq, amp, decay=1.0):
        self.freq = freq
        self.amp = amp
        self.n = 0
        self.decay = decay
        self.alive = True

    def render(self, block):
        t = (self.n + np.arange(block)) / SAMPLE_RATE
        sig = np.sin(2 * np.pi * self.freq * t + 0.03 * np.sin(2 * np.pi * 4.8 * t))
        sopro = np.random.uniform(-1.0, 1.0, block) * np.exp(-t / 0.05) * 0.18
        env = np.clip(t / 0.09, 0.0, 1.0) * np.exp(-np.clip(t - 0.09, 0.0, None) / self.decay)
        self.n += block
        if env[-1] < 0.003:
            self.alive = False
        return (sig + sopro) * env * self.amp


class _BowedVoice:
    """Corda em arco: dente-de-serra com vibrato e ataque lento."""
    __slots__ = ("freq", "amp", "n", "decay", "attack", "alive")

    def __init__(self, freq, amp, decay=2.0, attack=0.25):
        self.freq = freq
        self.amp = amp
        self.n = 0
        self.decay = decay
        self.attack = max(0.01, attack)
        self.alive = True

    def render(self, block):
        t = (self.n + np.arange(block)) / SAMPLE_RATE
        fase = self.freq * t + 0.006 * np.sin(2 * np.pi * 5.2 * t)
        sig = 2.0 * (fase % 1.0) - 1.0
        env = (np.clip(t / self.attack, 0.0, 1.0)
               * np.exp(-np.clip(t - self.attack, 0.0, None) / self.decay))
        self.n += block
        if env[-1] < 0.003:
            self.alive = False
        return sig * env * self.amp


class _FMVoice:
    """FM de dois operadores.

    A razão e o índice fazem o timbre, e é por isso que esta classe rende mais
    do que qualquer outra: 1.0/2.4 soa a piano elétrico, 2.0/4.5 a metais,
    1.5/3.0 a stab sintético, 1.0/0.8 a baixo com corpo. O índice cai com o
    tempo — é o que dá o ataque brilhante e o corpo escuro a seguir.
    """
    __slots__ = ("freq", "amp", "n", "ratio", "index", "decay", "attack_n", "alive")

    def __init__(self, freq, amp, ratio=2.0, index=3.0, decay=0.6, attack=0.005):
        self.freq = freq
        self.amp = amp
        self.n = 0
        self.ratio = ratio
        self.index = index
        self.decay = decay
        self.attack_n = max(1, int(max(0.001, attack) * SAMPLE_RATE))
        self.alive = True

    def render(self, block):
        local = self.n + np.arange(block)
        t = local / SAMPLE_RATE
        mod = (self.index * np.exp(-t / max(0.02, self.decay * 0.6))
               * np.sin(2 * np.pi * self.freq * self.ratio * t))
        sig = np.sin(2 * np.pi * self.freq * t + mod)
        env = np.clip(local / self.attack_n, 0.0, 1.0) * np.exp(-t / self.decay)
        self.n += block
        if env[-1] < 0.003 and local[-1] > self.attack_n:
            self.alive = False
        return sig * env * self.amp


def _instrumento(timbre, freq, amp, ataque, cauda):
    """Constrói a voz de um timbre. É aqui que o nome que o género escolheu vira som.

    A cauda chega já decidida pelo estado medido (`cauda` em segundos) e cada
    instrumento aplica-lhe um **fator**, nunca um valor próprio: assim o eixo da
    ativação continua a mandar na articulação de ponta a ponta, e trocar de
    género muda o timbre sem apagar a leitura da pessoa.
    """
    if timbre == "pluck":
        return _PluckVoice(freq, amp * 1.10, 0.55 * cauda)
    if timbre == "bell":
        return _BellVoice(freq, amp * 0.55, 1.60 * cauda)
    if timbre == "marimba":
        return _MarimbaVoice(freq, amp * 1.15, 0.60 * cauda)
    if timbre == "flute":
        return _FluteVoice(freq, amp * 0.85, 1.00 * cauda)
    if timbre == "organ":
        return _OrganVoice(freq, amp * 0.26, 0.90 * cauda)
    if timbre == "bowed":
        return _BowedVoice(freq, amp * 0.42, 1.20 * cauda, ataque + 0.12)
    if timbre == "rhodes":
        return _FMVoice(freq, amp * 0.95, 1.0, 2.4, 0.80 * cauda, ataque)
    if timbre == "fmbrass":
        return _FMVoice(freq, amp * 0.70, 2.0, 4.5, 0.70 * cauda, ataque + 0.03)
    return _Voice(freq, amp, timbre, ataque, cauda)


# ═══════════════════════════════════════════════════════════
# GÉNEROS
# ═══════════════════════════════════════════════════════════
# Até 2026-09-17 a peça tinha um só género. Os cinco timbres, o padrão rítmico,
# a mistura e o leque de escalas eram os mesmos do princípio ao fim: mudava o
# andamento, a densidade e o filtro, e mais nada. Quem ficasse vinte minutos na
# sala ouvia a mesma peça vinte minutos.
#
# Cada género é uma configuração das **mesmas cinco camadas** que o painel já
# controla — não há camadas novas, e o volume e o interruptor de cada uma
# continuam a ser do utilizador. O género escolhe o que cada camada toca:
#
#   escalas   trio (valência muito negativa, negativa, positiva). A direção é a
#             mesma de sempre e é compensatória — quanto mais baixa a valência,
#             mais clara a escala.
#   mix       ganho relativo de cada camada. Multiplica o volume do painel.
#   lead      três timbres da melodia, do mais articulado ao mais sustentado. A
#             energia musical escolhe entre eles.
#   harmonia  como a camada `piano` toca o acorde.
#   baixo     timbre da fundamental grave, na mesma camada.
#   coro      timbre do pad.
#   ritmo     padrão da camada `percussao` (ver `_RITMOS`).
#   mao       padrão da camada `tabla` (ver `_MAOS`).
#   bpm       fator de andamento, aplicado ao termo da ativação.
#   dens      fator de densidade de notas.
#   cauda     fator de duração das notas.
#   swing     atraso das semicolcheias pares (0 = quadrado, 0.33 = ternário).
#   hp        corte de graves da mistura, em Hz.
#   brilho    fator do filtro passa-baixo.
#   oitava    transposição da tónica.
#
# RIGOR: os valores são escolhas artísticas afinadas de ouvido. Os nomes dos
# géneros descrevem a **intenção** da textura, não uma reconstituição fiel de um
# estilo — isto é síntese aditiva e FM em tempo real, não instrumentos reais.
_GENEROS = {
    "ambiente": {
        "nome": "Ambient",
        "escalas": ("lydian", "whole_tone", "major_pent"),
        "mix": {"melodia": 0.90, "piano": 0.80, "coro": 1.40, "tabla": 0.20, "percussao": 0.12},
        "lead": ("bell", "flute", "sine"), "harmonia": "pad", "baixo": "sine", "coro": "voz",
        "ritmo": "pulso", "mao": "gota",
        "bpm": 0.70, "dens": 0.75, "cauda": 1.80, "swing": 0.00,
        "hp": 85.0, "brilho": 0.85, "oitava": 1.0,
    },
    "lofi": {
        "nome": "Lo-fi",
        "escalas": ("mixolydian", "dorian", "minor_pent"),
        "mix": {"melodia": 0.85, "piano": 1.10, "coro": 0.60, "tabla": 0.30, "percussao": 1.00},
        "lead": ("pluck", "rhodes", "sine"), "harmonia": "rhodes", "baixo": "fm", "coro": "voz",
        "ritmo": "boombap", "mao": "gota",
        "bpm": 0.80, "dens": 0.90, "cauda": 0.80, "swing": 0.30,
        "hp": 95.0, "brilho": 0.70, "oitava": 1.0,
    },
    "neoclassico": {
        "nome": "Neoclássico",
        "escalas": ("major", "lydian", "harmonic_minor"),
        "mix": {"melodia": 1.00, "piano": 1.30, "coro": 0.90, "tabla": 0.10, "percussao": 0.08},
        "lead": ("pluck", "bell", "sine"), "harmonia": "arpejo", "baixo": "sine", "coro": "arco",
        "ritmo": "pulso", "mao": "gota",
        "bpm": 0.88, "dens": 0.85, "cauda": 1.20, "swing": 0.12,
        "hp": 100.0, "brilho": 1.00, "oitava": 1.0,
    },
    "raga": {
        "nome": "Raga",
        "escalas": ("lydian", "phrygian", "hirajoshi"),
        "mix": {"melodia": 1.00, "piano": 0.50, "coro": 1.00, "tabla": 1.40, "percussao": 0.20},
        "lead": ("pluck", "flute", "bowed"), "harmonia": "drone", "baixo": "sine", "coro": "voz",
        "ritmo": "pulso", "mao": "tintal",
        "bpm": 0.95, "dens": 1.00, "cauda": 1.10, "swing": 0.08,
        "hp": 90.0, "brilho": 0.95, "oitava": 1.0,
    },
    "gamelao": {
        "nome": "Gamelão",
        "escalas": ("pelog", "hirajoshi", "whole_tone"),
        "mix": {"melodia": 1.20, "piano": 0.60, "coro": 0.70, "tabla": 0.90, "percussao": 0.35},
        "lead": ("marimba", "bell", "sine"), "harmonia": "bloco", "baixo": "sine", "coro": "voz",
        "ritmo": "gongo", "mao": "kotekan",
        "bpm": 1.10, "dens": 1.20, "cauda": 0.70, "swing": 0.00,
        "hp": 110.0, "brilho": 1.20, "oitava": 1.5,
    },
    "dub": {
        "nome": "Dub techno",
        "escalas": ("minor", "dorian", "phrygian"),
        "mix": {"melodia": 0.70, "piano": 1.00, "coro": 1.20, "tabla": 0.25, "percussao": 1.20},
        "lead": ("pluck", "sine", "bowed"), "harmonia": "stab", "baixo": "sub", "coro": "voz",
        "ritmo": "quatro", "mao": "clave",
        "bpm": 0.92, "dens": 0.70, "cauda": 1.40, "swing": 0.00,
        "hp": 70.0, "brilho": 0.65, "oitava": 0.75,
    },
    "jazz": {
        "nome": "Jazz modal",
        "escalas": ("mixolydian", "dorian", "minor"),
        "mix": {"melodia": 0.95, "piano": 1.10, "coro": 0.55, "tabla": 0.35, "percussao": 0.85},
        "lead": ("pluck", "rhodes", "triangle"), "harmonia": "rhodes", "baixo": "pluck", "coro": "voz",
        "ritmo": "vassoura", "mao": "shaker",
        "bpm": 1.05, "dens": 1.10, "cauda": 0.75, "swing": 0.33,
        "hp": 100.0, "brilho": 0.90, "oitava": 1.0,
    },
    "bossa": {
        "nome": "Bossa",
        "escalas": ("major", "lydian", "major_pent"),
        "mix": {"melodia": 0.90, "piano": 1.00, "coro": 0.50, "tabla": 0.80, "percussao": 0.60},
        "lead": ("pluck", "flute", "sine"), "harmonia": "arpejo", "baixo": "pluck", "coro": "voz",
        "ritmo": "bossa", "mao": "clave",
        "bpm": 1.00, "dens": 1.00, "cauda": 0.80, "swing": 0.18,
        "hp": 105.0, "brilho": 1.05, "oitava": 1.0,
    },
    "berlim": {
        "nome": "Berlin school",
        "escalas": ("phrygian", "minor", "dorian"),
        "mix": {"melodia": 1.10, "piano": 0.70, "coro": 1.00, "tabla": 0.20, "percussao": 0.70},
        "lead": ("pluck", "saw", "sine"), "harmonia": "pad", "baixo": "fm", "coro": "voz",
        "ritmo": "quatro", "mao": "clave",
        "bpm": 1.20, "dens": 1.35, "cauda": 0.60, "swing": 0.00,
        "hp": 95.0, "brilho": 1.10, "oitava": 1.0,
    },
    "folk": {
        "nome": "Folk",
        "escalas": ("mixolydian", "major", "minor_pent"),
        "mix": {"melodia": 1.00, "piano": 0.80, "coro": 0.60, "tabla": 1.00, "percussao": 0.50},
        "lead": ("pluck", "marimba", "flute"), "harmonia": "bloco", "baixo": "pluck", "coro": "arco",
        "ritmo": "bodhran", "mao": "shaker",
        "bpm": 1.05, "dens": 1.05, "cauda": 0.80, "swing": 0.15,
        "hp": 100.0, "brilho": 1.00, "oitava": 1.0,
    },
    "coral": {
        "nome": "Coral",
        "escalas": ("harmonic_minor", "minor", "major"),
        "mix": {"melodia": 0.80, "piano": 0.90, "coro": 1.50, "tabla": 0.10, "percussao": 0.08},
        "lead": ("bell", "organ", "bowed"), "harmonia": "orgao", "baixo": "sine", "coro": "orgao",
        "ritmo": "pulso", "mao": "gota",
        "bpm": 0.75, "dens": 0.70, "cauda": 1.70, "swing": 0.00,
        "hp": 85.0, "brilho": 0.80, "oitava": 1.0,
    },
    "synthwave": {
        "nome": "Synthwave",
        "escalas": ("minor", "dorian", "major_pent"),
        "mix": {"melodia": 1.00, "piano": 0.90, "coro": 0.90, "tabla": 0.20, "percussao": 1.15},
        "lead": ("pluck", "saw", "fmbrass"), "harmonia": "stab", "baixo": "sub", "coro": "arco",
        "ritmo": "electro", "mao": "clave",
        "bpm": 1.15, "dens": 1.15, "cauda": 0.90, "swing": 0.00,
        "hp": 80.0, "brilho": 1.15, "oitava": 1.0,
    },
    "deserto": {
        "nome": "Desert blues",
        "escalas": ("blues", "minor_pent", "mixolydian"),
        "mix": {"melodia": 1.00, "piano": 0.75, "coro": 0.60, "tabla": 1.10, "percussao": 0.60},
        "lead": ("pluck", "saw", "bowed"), "harmonia": "bloco", "baixo": "pluck", "coro": "arco",
        "ritmo": "shuffle", "mao": "djembe",
        "bpm": 1.00, "dens": 1.00, "cauda": 0.85, "swing": 0.25,
        "hp": 95.0, "brilho": 0.95, "oitava": 1.0,
    },
    "minimal": {
        "nome": "Minimalismo",
        "escalas": ("major_pent", "lydian", "dorian"),
        "mix": {"melodia": 1.20, "piano": 0.60, "coro": 0.80, "tabla": 0.50, "percussao": 0.30},
        "lead": ("marimba", "pluck", "sine"), "harmonia": "bloco", "baixo": "sine", "coro": "voz",
        "ritmo": "pulso", "mao": "clave",
        "bpm": 1.12, "dens": 1.30, "cauda": 0.55, "swing": 0.00,
        "hp": 110.0, "brilho": 1.10, "oitava": 1.0,
    },
}

#: Teto de polifonia. O callback de áudio tem 23 ms para devolver um bloco de
#: 1024 amostras e não pode falhar um: um underrun soa a estalo, e a regra dura
#: do projeto é que o som do ambiente virtual nunca para. Os géneros mais densos
#: chegavam a 140 vozes vivas ao mesmo tempo, e o custo cresce com elas. Quando
#: passa do teto morrem as mais antigas — as que já estão mais fundo no decay, e
#: por isso as que menos se ouvem ir embora.
_MAX_VOZES = 96

#: Género do arranque. Fixo de propósito: a peça abre sempre no mesmo sítio, e é
#: o que torna reproduzíveis os testes que medem andamento num motor acabado de
#: construir.
_GENERO_INICIAL = "ambiente"
#: Quantos compassos dura um género antes de a peça mudar de sítio (mín., máx.).
#: A 16 passos por compasso e ~90 BPM, 8 a 20 compassos são 20 a 55 segundos:
#: tempo para a textura assentar e ser reconhecida, e pouco para enfadar.
_COMPASSOS_POR_GENERO = (8, 21)

#: Padrões da camada `percussao`, em passos de semicolcheia dentro do compasso de
#: 16. `hat_cor` e `hat_decay` dão a cor do chimbau: brilhante e curto no
#: electro, escuro e longo nas escovas do jazz.
_RITMOS = {
    "pulso":    {"kick": (0,), "hat": (8,), "hat_cor": -0.5, "hat_decay": 0.350},
    "quatro":   {"kick": (0, 4, 8, 12), "hat": (2, 6, 10, 14), "clap": (8,),
                 "hat_cor": 0.9, "hat_decay": 0.030},
    "boombap":  {"kick": (0, 10), "snare": (4, 12), "hat": (0, 2, 4, 6, 8, 10, 12, 14),
                 "hat_cor": 0.5, "hat_decay": 0.040},
    "electro":  {"kick": (0, 6, 8, 14), "clap": (4, 12), "hat": (2, 6, 10, 14),
                 "hat_cor": 1.0, "hat_decay": 0.022},
    "vassoura": {"hat": (0, 3, 4, 7, 8, 11, 12, 15), "snare": (12,),
                 "hat_cor": -0.6, "hat_decay": 0.085},
    "bossa":    {"kick": (0, 6, 8, 14), "hat": (2, 6, 10, 14),
                 "hat_cor": 0.7, "hat_decay": 0.035},
    "shuffle":  {"kick": (0, 8), "snare": (4, 12), "hat": (0, 3, 6, 8, 11, 14),
                 "hat_cor": 0.4, "hat_decay": 0.050},
    "bodhran":  {"kick": (0, 6, 8), "hat": (2, 10, 14),
                 "hat_cor": -0.3, "hat_decay": 0.060},
    "gongo":    {"gongo": (0,), "hat": (8,), "hat_cor": 0.2, "hat_decay": 0.200},
}

#: Padrões da camada `tabla`, em (passo, frequência da membrana, amplitude).
#: Frequência 0 troca a membrana por um shaker de ruído brilhante.
_MAOS = {
    "tintal":  ((0, 210.0, 0.42), (3, 150.0, 0.30), (6, 210.0, 0.34),
                (8, 260.0, 0.30), (11, 150.0, 0.28), (14, 210.0, 0.36)),
    "kotekan": ((0, 320.0, 0.30), (2, 260.0, 0.26), (4, 320.0, 0.30), (6, 260.0, 0.26),
                (8, 320.0, 0.30), (10, 260.0, 0.26), (12, 320.0, 0.30), (14, 260.0, 0.26)),
    "clave":   ((0, 240.0, 0.30), (3, 240.0, 0.28), (6, 240.0, 0.28),
                (10, 240.0, 0.30), (12, 240.0, 0.28)),
    "djembe":  ((0, 120.0, 0.44), (4, 230.0, 0.30), (6, 300.0, 0.24),
                (8, 120.0, 0.38), (12, 230.0, 0.30), (14, 300.0, 0.22)),
    "shaker":  ((0, 0.0, 0.10), (2, 0.0, 0.07), (4, 0.0, 0.10), (6, 0.0, 0.07),
                (8, 0.0, 0.10), (10, 0.0, 0.07), (12, 0.0, 0.10), (14, 0.0, 0.07)),
    "gota":    ((0, 180.0, 0.22), (9, 140.0, 0.18)),
}


class GenerativeMusicEngine:
    """Sequenciador generativo em tempo real com 5 camadas controláveis.

    Duas coisas mandam no que se ouve, e não se confundem uma com a outra:

    * o **estado medido** (`val`, `aro`) decide a energia da peça, e a direção é
      compensatória — quem chega agitado recebe música parada, quem chega parado
      recebe música viva. Densidade, andamento, articulação, presença de cada
      camada e abertura do filtro saem todos daqui.
    * o **género** decide o material: que instrumentos, que padrão rítmico, que
      escalas, que mistura. Roda sozinho de 8 em 8 a 20 em 20 compassos, e não
      toca na leitura da pessoa — a mesma pessoa em dois géneros ouve duas peças
      diferentes com a mesma energia.
    """
    _MOTIFS = [
        [0, -1, 2, -1, 4, 3, 5, 4], [0, 2, 4, 7, 4, 2], [4, 2, 0, 2, 4, 4, 4],
        [0, -1, 4, -1, 7, -1, 4], [7, 6, 5, 4, 3, 2, 1, 0], [0, 2, 4, 2, 0, -1],
        [0, 4, 7, 4, 0, 4, 7, 9], [2, -1, 2, 4, -1, 5, 4, 2], [0, 3, 5, 3, 7, 5, 3, 0],
        [5, 4, 2, -1, 4, 2, 0, -1], [0, 7, 5, 7, 0, 7, 4, 7], [3, 2, 3, 5, 3, 2, 0, -1],
        [0, 1, 2, 3, 4, 5, 6, 7], [6, -1, 4, -1, 2, -1, 0, -1], [0, 5, 4, 5, 0, 5, 7, 5],
        [2, 4, 5, 7, 5, 4, 2, 0], [7, -1, 7, 5, -1, 4, -1, 2], [0, 0, 3, 3, 5, 5, 4, -1],
        [4, 5, 4, 2, 0, -1, 0, 2], [1, 2, 3, 2, 1, 0, -1, 0], [0, 6, 5, 3, 2, -1, 4, -1],
        [5, 3, 5, 7, 8, 7, 5, 3],
    ]

    def __init__(self):
        self.voices = []            # lista de (layer_name, voice)
        self.sample_counter = 0
        self.next_step_at = 0
        self.step = 0
        self.measure_step = 0
        self.measure_len = 16
        self.motif = []
        self._hp_zi = None
        self._lp_zi = None
        self.genero = _GENERO_INICIAL
        music_state["genre"] = _GENEROS[self.genero]["nome"]
        # Gerador próprio para o género e para a deriva da mistura. Semeado a
        # partir do gerador global no arranque: a peça continua a ser diferente
        # de sessão para sessão, mas a sequência de géneros deixa de depender de
        # quantos sorteios as notas gastaram pelo caminho — que é o que torna o
        # `test_musica.py` comparável entre dois estados diferentes.
        self._rng = np.random.RandomState(int(np.random.randint(1 << 30)))
        self._proximo_genero = _COMPASSOS_POR_GENERO[0]
        self._deriva = {camada: 1.0 for camada in audio_layers}
        self._hp_fc = _GENEROS[self.genero]["hp"]

    def _rodar_genero(self, measure_idx):
        """Troca de género quando o compasso chega. Nunca repete o atual."""
        if measure_idx < self._proximo_genero:
            return
        nomes = [n for n in _GENEROS if n != self.genero]
        self.genero = nomes[self._rng.randint(len(nomes))]
        self._proximo_genero = measure_idx + int(self._rng.randint(*_COMPASSOS_POR_GENERO))
        music_state["genre"] = _GENEROS[self.genero]["nome"]

    def _derivar_mistura(self):
        """Passeio aleatório lento no peso de cada camada, um passo por compasso.

        Sem isto a mistura de um género era fixa: os mesmos instrumentos sempre
        na mesma proporção, do princípio ao fim. O passo é pequeno (±0,18) e o
        intervalo é limitado a 0,55–1,35 — a mistura respira, mas nenhuma camada
        desaparece nem toma conta da peça. Multiplica o volume do painel; não o
        substitui, e não é ouvido pelos controlos do utilizador.
        """
        for camada in self._deriva:
            passo = self._deriva[camada] + self._rng.uniform(-0.18, 0.18)
            self._deriva[camada] = min(1.35, max(0.55, passo))

    def _select_palette(self, val, g):
        # Eixo Mood (Valência), dentro do leque do género: quanto mais negativa a
        # valência, mais clara a escala — regulação compensatória, a mesma
        # direção de sempre. force_scale (voz) e a escolha do painel têm
        # prioridade, por esta ordem.
        if compensatory["force_scale"] in _SCALES:
            return compensatory["force_scale"]
        if user_music["scale"] in _SCALES:
            return user_music["scale"]
        if val <= -0.5:
            return g["escalas"][0]
        if val < 0.15:
            return g["escalas"][1]
        return g["escalas"][2]

    def _step_interval_samples(self, aro, val=0.0):
        # Eixo Energia (Arousal): quanto mais ativado, mais lento — regulação
        # compensatória do andamento. O intervalo foi 60-120, depois 46-132,
        # depois 46-160, e agora atravessa 30-170 com o fator do género por cima:
        # atravessar o plano de Russell tem de soar como mudar de peça, e mudar
        # de género também.
        #
        # A valência entra como segundo termo e **fora** do fator do género: 40
        # BPM entre os dois lados do plano, os mesmos 40 em qualquer género. Se
        # multiplicasse, o Ambient encolhia o eixo do humor para 28 BPM e o
        # Berlin school esticava-o para 48 — a mesma leitura a valer coisas
        # diferentes conforme a textura, que é exatamente o que não pode ser.
        g = _GENEROS[self.genero]
        bpm = (140.0 - 94.0 * clamp(aro)) * g["bpm"] + 20.0 * clamp(val, -1.0, 1.0)
        bpm *= compensatory["bpm_mult"] * user_music["bpm_mult"]
        bpm = max(30.0, min(170.0, bpm))
        music_state["bpm"] = int(bpm)
        steps_per_sec = (bpm / 60.0) * 4.0   # 16 passos por compasso (semicolcheias)
        intervalo = SAMPLE_RATE / steps_per_sec
        # Swing: alonga as semicolcheias pares e encurta as ímpares na mesma
        # medida, por isso o compasso dura o mesmo — só deixa de ser quadrado.
        if g["swing"]:
            intervalo *= (1.0 + g["swing"]) if self.measure_step % 2 == 0 else (1.0 - g["swing"])
        return max(1, int(intervalo))

    def _acorde(self, g, base, chord, calm, tenso, _h):
        """A camada `piano`, tocada à maneira do género."""
        estilo = g["harmonia"]
        inversion = np.random.randint(3)
        for i, semi in enumerate(chord):
            s = semi + (12 if i < inversion else 0)
            f = _semitone_to_freq(base, s)
            amp = _h(0.05 + 0.10 * calm, "piano")
            # Ataques progressivos = strum. O strum abre com a tensão: de acorde
            # cerrado (0,02 s entre notas) a arpejo lento (0,09 s).
            atraso = 0.015 + i * (0.02 + 0.07 * tenso)
            cauda = 2.0 + 2.8 * tenso
            if estilo == "pad":
                self.voices.append(("piano", _Voice(f, amp * 0.55, "sine",
                                                    0.5 + 1.2 * tenso, cauda * 1.5)))
            elif estilo == "bloco":
                self.voices.append(("piano", _Voice(f, amp, "triangle", 0.015, cauda * 0.6)))
            elif estilo == "rhodes":
                self.voices.append(("piano", _FMVoice(f, amp * 0.90, 1.0, 2.2,
                                                      cauda * 0.45, atraso)))
            elif estilo == "orgao":
                self.voices.append(("piano", _OrganVoice(f, amp * 0.30, cauda * 0.8)))
            elif estilo == "stab":
                self.voices.append(("piano", _FMVoice(f, amp * 0.80, 1.5, 3.0,
                                                      0.16 + 0.30 * tenso, 0.004)))
            elif estilo == "drone":
                if i < 2:   # só fundamental e quinta, sustentadas
                    self.voices.append(("piano", _Voice(f, amp * 0.70, "saw",
                                                        1.2, cauda * 2.0)))
            else:           # arpejo
                self.voices.append(("piano", _Voice(f, amp, "triangle", atraso, cauda)))

    def _baixo(self, g, base, calm, tenso, _h):
        """A fundamental grave, na camada `piano`. O timbre é do género."""
        tipo = g["baixo"]
        amp = _h(0.09 + 0.12 * calm, "piano")
        f = base * 0.5
        if tipo == "sub":
            self.voices.append(("piano", _FMVoice(f, amp * 1.30, 1.0, 0.8,
                                                  1.2 + 1.2 * tenso, 0.006)))
        elif tipo == "fm":
            self.voices.append(("piano", _FMVoice(f, amp * 1.10, 2.0, 2.2,
                                                  0.8 + 1.0 * tenso, 0.005)))
        elif tipo == "pluck":
            self.voices.append(("piano", _PluckVoice(f, amp * 1.20, 0.5 + 0.8 * tenso)))
        else:
            self.voices.append(("piano", _Voice(f, amp, "sine",
                                                0.01 + 0.06 * tenso, 1.4 + 1.8 * tenso)))

    def _spawn_step(self, val, aro):
        is_down = (self.measure_step == 0)
        measure_idx = self.step // self.measure_len
        if is_down:
            self._rodar_genero(measure_idx)
            self._derivar_mistura()
        g = _GENEROS[self.genero]
        base = synth_base_f0 * g["oitava"]
        key = self._select_palette(val, g)
        scale, chord = _SCALES[key], _CHORDS[key]
        # `calm` é a **energia musical**, e é o inverso da ativação da pessoa:
        # regulação compensatória — quem chega agitado recebe música parada, quem
        # chega parado recebe música viva. Até 2026-09-17 só a densidade, o
        # andamento, a escala e o filtro liam isto: piano, coro, tabla e
        # percussão tocavam exatamente igual nos quatro quadrantes, e por isso
        # metade do que se ouve não respondia a ninguém. Agora todas as camadas
        # saem daqui — quantas notas, com que amplitude, com que cauda, em que
        # registo.
        #
        # RIGOR: a direção (compensar o estado medido) é a hipótese de trabalho
        # da peça, documentada e não validada. Os números abaixo são escolhas
        # artísticas afinadas de ouvido, não constantes com fundamento
        # experimental — não devem ser descritas como outra coisa.
        calm = 1.0 - clamp(aro)          # ativado → calm baixo → menos densidade
        tenso = 1.0 - calm               # o mesmo eixo, pelo outro lado
        # Intervalo alargado de 0.25-0.70 para 0.12-0.88: a densidade é o que
        # mais se ouve mudar, e a faixa anterior deixava sempre a textura no
        # mesmo registo médio. A valência desloca-a ligeiramente — o lado
        # positivo adensa, o negativo rarefaz. O género escala o resultado.
        # O fator do género entra **antes** do limite, não depois: a seguir ao
        # limite, um género denso (1,35) empurrava o lado calmo para 1,28 — uma
        # probabilidade que satura em 1 e perde a diferença — enquanto o lado
        # ativado, longe do teto, crescia na mesma. A rarefação que a ativação
        # tem de produzir encolhia por causa da textura escolhida.
        density = (0.12 + 0.76 * calm + 0.10 * clamp(val, -1.0, 1.0)) * g["dens"]
        density = max(0.05, min(0.95, density))
        music_state["scale"] = key
        music_state["density"] = round(density, 2)

        def _h(amp, camada):
            # Mistura do género × deriva lenta da mistura × humanização de
            # dinâmica (±15% por nota). O volume do painel entra depois, no
            # `process_block` — este ganho não lhe mexe.
            return (amp * g["mix"][camada] * self._deriva[camada]
                    * np.random.uniform(0.85, 1.15))

        # Melodia — motivos, saltos de oitava, timbre escolhido pelo género
        if audio_layers["melodia"]["on"]:
            deg = None
            if self.motif:
                deg = self.motif.pop(0)
            elif np.random.random() < density:
                # O motivo toca-se até ao fim, densidade ou não. Com o disparo
                # fixo em 25% isso enchia o lado tenso de frases: a densidade
                # caía a um quinto e as notas só caíam a metade, porque um quinto
                # dos passos ficava dentro de um motivo em curso. Dispara agora
                # em proporção da densidade, por isso a frase melódica é do lado
                # da energia e o lado tenso fica com notas soltas e longas — que
                # é a textura que a compensação quer lá.
                if np.random.random() < 0.25 * density:
                    self.motif = list(self._MOTIFS[np.random.randint(len(self._MOTIFS))])
                    deg = self.motif.pop(0) if self.motif else None
                else:
                    deg = np.random.randint(len(scale))
            if deg is not None and deg != -1:
                # Registo: a melodia sobe com a energia musical. Quem está agitado
                # ouve graves longos; quem está calmo ouve a melodia a saltar
                # oitavas. Era uma moeda ao ar fixa em 15%.
                r = np.random.random()
                if r < 0.10 + 0.55 * calm:
                    octave = 4.0
                elif r > 1.0 - 0.40 * tenso:
                    octave = 1.0
                else:
                    octave = 2.0
                freq = _semitone_to_freq(base * octave, scale[deg % len(scale)])
                # Cauda contínua, de 0,45 s (curta, articulada) a 2,2 s (as notas
                # sobrepõem-se e viram textura), escalada pelo género. Era um
                # degrau binário em aro=0,6.
                cauda = (0.45 + 1.75 * tenso) * g["cauda"]
                ataque = np.random.uniform(0.008, 0.02) + 0.05 * tenso
                # O género traz três timbres, do mais articulado ao mais
                # sustentado, e a energia musical escolhe entre eles: quem está
                # calmo ouve o gesto, quem está ativado ouve a cauda.
                r = np.random.random()
                if r < 0.20 + 0.50 * calm:
                    timbre = g["lead"][0]
                elif r < 0.75:
                    timbre = g["lead"][1]
                else:
                    timbre = g["lead"][2]
                self.voices.append(("melodia", _instrumento(
                    timbre, freq, _h(0.20 + 0.10 * calm, "melodia"), ataque, cauda)))
                last_melody_note["name"] = _freq_to_name(freq)
                last_melody_note["id"] += 1
            # Sinos etéreos: o ornamento de quem está ativado — som esparso,
            # agudo e de cauda longa por cima de uma textura quase parada.
            if np.random.random() < 0.015 + 0.055 * tenso:
                bfreq = _semitone_to_freq(base * 4.0, scale[np.random.randint(len(scale))])
                self.voices.append(("melodia", _BellVoice(
                    bfreq, _h(0.06 + 0.08 * tenso, "melodia"), 1.6 + 1.4 * tenso)))

        # Piano — acorde à maneira do género + baixo na fundamental. De um acorde
        # por compasso (energia alta) a um de quatro em quatro (pessoa ativada):
        # o piano rareia à medida que a peça acalma.
        if audio_layers["piano"]["on"] and is_down:
            cada = 1 if calm > 0.6 else (2 if calm > 0.3 else 4)
            if measure_idx % cada == 0:
                self._acorde(g, base, chord, calm, tenso, _h)
            self._baixo(g, base, calm, tenso, _h)

        # Coro — pad com par desafinado para largura estéreo percetiva. É a camada
        # que **cresce** quando as outras se calam: para quem está ativado o pad é
        # quase tudo o que resta a soar, e é ele que impede que compensar a
        # agitação acabe em silêncio. Nenhum género o desliga.
        if audio_layers["coro"]["on"] and is_down and np.random.random() < 0.45 + 0.50 * tenso:
            desafinacao = 0.0035 + 0.0045 * tenso   # batimento mais largo e mais lento
            timbre = g["coro"]
            for semi in chord:
                f0 = _semitone_to_freq(base, semi)
                for det in (1.0 - desafinacao, 1.0 + desafinacao):
                    amp = _h(0.022 + 0.055 * tenso, "coro")
                    if timbre == "orgao":
                        self.voices.append(("coro", _OrganVoice(
                            f0 * det, amp * 0.30, 2.0 + 3.0 * tenso)))
                    elif timbre == "arco":
                        self.voices.append(("coro", _BowedVoice(
                            f0 * det, amp * 0.60, 2.5 + 3.5 * tenso, 0.7 + 1.4 * tenso)))
                    else:
                        self.voices.append(("coro", _Voice(
                            f0 * det, amp, "sine", 0.6 + 1.6 * tenso, 2.5 + 3.5 * tenso)))

        # Tabla — percussão de mão, com o padrão do género. O padrão mantém-se,
        # mas deixa de ser tocado por inteiro sempre: com a pessoa ativada sobram
        # golpes soltos e fracos; com a pessoa calma volta o ciclo completo e a
        # toda a força.
        if audio_layers["tabla"]["on"] and not compensatory["mute_perc"]:
            ganho = 0.35 + 0.65 * calm
            for passo, freq_mem, amp in _MAOS[g["mao"]]:
                if self.measure_step != passo:
                    continue
                if np.random.random() > 0.25 + 0.75 * calm:
                    continue
                a = _h(amp * ganho, "tabla")
                if freq_mem <= 0.0:
                    self.voices.append(("tabla", _NoiseVoice(a * 0.55, 0.045, cor=0.9)))
                else:
                    self.voices.append(("tabla", _TablaVoice(a, base=freq_mem)))

        # Percussão — bateria, com o padrão do género. O tempo forte nunca
        # desaparece (é o que segura a peça de pé), mas passa de 0,25 a 0,80 de
        # amplitude ao longo do eixo; as síncopas, os ghost notes e os pratos são
        # privilégio de quem está calmo.
        if audio_layers["percussao"]["on"] and not compensatory["mute_perc"]:
            r = _RITMOS[g["ritmo"]]
            for passo in r.get("kick", ()):
                if self.measure_step != passo:
                    continue
                forte = (passo == 0)
                if not forte and np.random.random() > 0.10 + 0.70 * calm:
                    continue
                pico = (0.25 + 0.55 * calm) if forte else (0.18 + 0.45 * calm)
                self.voices.append(("percussao", _KickVoice(_h(pico, "percussao"))))
            for passo in r.get("snare", ()):
                if self.measure_step == passo and np.random.random() < 0.25 + 0.70 * calm:
                    self.voices.append(("percussao", _SnareVoice(
                        _h(0.10 + 0.20 * calm, "percussao"))))
            for passo in r.get("clap", ()):
                if self.measure_step == passo and np.random.random() < 0.20 + 0.65 * calm:
                    self.voices.append(("percussao", _ClapVoice(
                        _h(0.06 + 0.12 * calm, "percussao"))))
            for passo in r.get("hat", ()):
                if self.measure_step == passo and np.random.random() < 0.20 + 0.75 * calm:
                    self.voices.append(("percussao", _NoiseVoice(
                        _h(0.035 + 0.085 * calm, "percussao"),
                        r.get("hat_decay", 0.035), cor=r.get("hat_cor", 0.5))))
            for passo in r.get("gongo", ()):
                if self.measure_step == passo and np.random.random() < 0.15 + 0.55 * calm:
                    self.voices.append(("percussao", _BellVoice(
                        base * 0.5, _h(0.05 + 0.06 * calm, "percussao"), 3.0)))

        if len(self.voices) > _MAX_VOZES:
            self.voices.sort(key=lambda lv: lv[1].n)     # mais novas primeiro
            del self.voices[_MAX_VOZES:]

        self.step += 1
        self.measure_step = (self.measure_step + 1) % self.measure_len

    def _highpass(self, x, fc):
        if not _FILTERS_OK:
            return x
        dt = 1.0 / SAMPLE_RATE
        rc = 1.0 / (2 * np.pi * fc)
        a = rc / (rc + dt)
        if self._hp_zi is None:
            self._hp_zi = np.zeros(1)
        y, self._hp_zi = _lfilter([a, -a], [1.0, -a], x, zi=self._hp_zi)
        return y

    def _lowpass(self, x, fc):
        if not _FILTERS_OK:
            return x
        dt = 1.0 / SAMPLE_RATE
        rc = 1.0 / (2 * np.pi * max(50.0, fc))
        alpha = dt / (rc + dt)
        if self._lp_zi is None:
            self._lp_zi = np.zeros(1)
        y, self._lp_zi = _lfilter([alpha], [1.0, -(1.0 - alpha)], x, zi=self._lp_zi)
        return y

    def process_block(self, val, aro):
        if self.sample_counter >= self.next_step_at:
            self._spawn_step(val, aro)
            self.next_step_at = self.sample_counter + self._step_interval_samples(aro, val)
        self.sample_counter += BLOCK_SIZE

        mix = np.zeros(BLOCK_SIZE, dtype=np.float64)
        alive = []
        for layer, v in self.voices:
            g = audio_layers[layer]["vol"] if audio_layers[layer]["on"] else 0.0
            sig = v.render(BLOCK_SIZE)
            if g > 0.0:
                mix += sig * g
            if v.alive:
                alive.append((layer, v))
        self.voices = alive

        genero = _GENEROS[self.genero]
        mix *= synth_volume
        # Corte de sub-graves, agora do género: 70 Hz no dub (o sub tem de
        # passar) contra 110 Hz no gamelão (não há nada lá em baixo a fazer
        # falta). Desliza para o valor novo em vez de saltar — trocar os
        # coeficientes de um bloco para o outro com o estado antigo lá dentro dá
        # um estalo, e o estalo ouve-se mais do que o filtro.
        self._hp_fc += (genero["hp"] - self._hp_fc) * 0.05
        mix = self._highpass(mix, self._hp_fc)
        # Brilho: a ativação fecha o filtro (regulação compensatória) e a
        # valência abre-o. O género inclina o resultado — o lo-fi é abafado de
        # propósito, o gamelão é metálico de propósito.
        cutoff = 320.0 + 5200.0 * (1.0 - clamp(aro)) + 1400.0 * clamp(val, -1.0, 1.0)
        cutoff = (max(220.0, cutoff) * genero["brilho"]
                  * compensatory["cutoff_mult"] * user_music["cutoff_mult"])
        music_state["cutoff"] = int(cutoff)
        mix = self._lowpass(mix, cutoff)
        mix = np.tanh(mix * 1.4) * 0.85       # compressor suave + limiter
        return np.clip(mix, -1.0, 1.0)


_music_engine = GenerativeMusicEngine()

def _audio_callback(outdata, frames, time_info, status):
    if not synth_active or synth_volume <= 0.005:
        audio_spectrum_state["bass"] = audio_spectrum_state["mid"] = audio_spectrum_state["treble"] = 0.0
        outdata.fill(0)
        return
    try:
        block = _music_engine.process_block(
            float(smoothed.get("val", 0.0)),
            float(smoothed.get("aro", 0.0)),
        )
        _update_audio_spectrum(block)
    except Exception:
        outdata.fill(0)
        return
    n = min(len(block), frames)
    outdata[:n, 0] = block[:n]
    outdata[:n, 1] = block[:n]
    if n < frames:
        outdata[n:].fill(0)


class MusicSynthThread(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.stream = None

    def run(self):
        try:
            import sounddevice as sd
        except Exception as e:
            print(f"[AUDIO] Aviso: sounddevice indisponível: {e}", file=sys.stderr)
            return
        print("[AUDIO] A iniciar motor generativo multicamada via sounddevice...", file=sys.stderr)
        # Watchdog: o som do ambiente virtual não pode parar. Se o stream cair
        # (mudança/falha do dispositivo de saída, erro PortAudio), recria-o.
        while True:
            try:
                self.stream = sd.OutputStream(
                    samplerate=SAMPLE_RATE,
                    channels=2,
                    callback=_audio_callback,
                    blocksize=BLOCK_SIZE,
                )
                with self.stream:
                    print("[AUDIO] Motor generativo multicamada ativo em tempo real.", file=sys.stderr)
                    while self.stream.active:
                        time.sleep(1.0)
                print("[AUDIO] Stream de áudio parou — a reiniciar...", file=sys.stderr)
            except Exception as e:
                print(f"[AUDIO] Falha no motor generativo: {e} — novo arranque em 2 s...", file=sys.stderr)
            time.sleep(2.0)

# ═══════════════════════════════════════════════════════════
# FUNÇÕES UTILITÁRIAS
# ═══════════════════════════════════════════════════════════
def clamp(v, lo=0.0, hi=1.0):
    return min(max(v, lo), hi)

def compute_ear(lms, eye_idx):
    def dist(a, b):
        return np.hypot(lms[a][0] - lms[b][0], lms[a][1] - lms[b][1])
    v = dist(eye_idx["top"], eye_idx["bottom"])
    h = dist(eye_idx["outer"], eye_idx["inner"])
    return (v / h) if h > 0 else 0.3

# Modelo 3D genérico da cabeça (mm, nariz na origem) em eixos de câmara na pose
# neutra: +x direita, +y baixo, +z a afastar-se da câmara (nariz é o ponto mais
# próximo → restantes pontos têm z positivo). Pose neutra dá rotação ~identidade.
# Convenção de sinais validada por teste sintético (projeção com rotação conhecida).
_HEAD_POSE_3D = np.array([
    (0.0,    0.0,    0.0),   # nariz (NOSE_TIP)
    (0.0,    330.0,  65.0),  # queixo (CHIN)
    (-225.0, -170.0, 135.0), # canto externo olho esq (LEFT_EYE_OUTER)
    (225.0,  -170.0, 135.0), # canto externo olho dir (RIGHT_EYE_OUTER)
    (-150.0, 150.0,  125.0), # canto boca esq (MOUTH_LEFT)
    (150.0,  150.0,  125.0), # canto boca dir (MOUTH_RIGHT)
], dtype=np.float64)
_HEAD_POSE_IDX = [NOSE_TIP, CHIN, LEFT_EYE_OUTER, RIGHT_EYE_OUTER, MOUTH_LEFT, MOUTH_RIGHT]
_pnp_state = {"rvec": None, "tvec": None}

def _head_pose_geometric(lms):
    nose_tip  = lms[NOSE_TIP]
    left_eye  = lms[LEFT_EYE_OUTER]
    right_eye = lms[RIGHT_EYE_OUTER]
    face_w = np.hypot(left_eye[0] - right_eye[0], left_eye[1] - right_eye[1])
    if face_w < 0.001: face_w = 0.001
    eye_mid_x = (left_eye[0] + right_eye[0]) / 2
    eye_mid_y = (left_eye[1] + right_eye[1]) / 2
    yaw   = ((nose_tip[0] - eye_mid_x) / face_w) * 90.0
    pitch = ((nose_tip[1] - eye_mid_y) / face_w) * -90.0
    roll  = np.degrees(np.arctan2(right_eye[1] - left_eye[1], right_eye[0] - left_eye[0]))
    return pitch, yaw, roll

def compute_head_pose(lms, w_img, h_img):
    try:
        pts2d = np.array([(lms[i][0] * w_img, lms[i][1] * h_img) for i in _HEAD_POSE_IDX],
                         dtype=np.float64)
        cam = np.array([[w_img, 0, w_img / 2],
                        [0, w_img, h_img / 2],
                        [0, 0, 1]], dtype=np.float64)
        use_guess = _pnp_state["rvec"] is not None
        ok, rvec, tvec = cv2.solvePnP(
            _HEAD_POSE_3D, pts2d, cam, np.zeros(4),
            rvec=_pnp_state["rvec"], tvec=_pnp_state["tvec"],
            useExtrinsicGuess=use_guess, flags=cv2.SOLVEPNP_ITERATIVE)
        if not ok:
            raise ValueError("solvePnP falhou")
        _pnp_state["rvec"], _pnp_state["tvec"] = rvec, tvec
        R, _ = cv2.Rodrigues(rvec)
        angles, *_ = cv2.RQDecomp3x3(R)
        # Sinais alinhados com a convenção da versão geométrica:
        # pitch > 0 = olhar para cima; yaw > 0 = nariz para a direita na imagem
        pitch, yaw, roll = -angles[0], -angles[1], angles[2]
    except Exception:
        _pnp_state["rvec"], _pnp_state["tvec"] = None, None
        pitch, yaw, roll = _head_pose_geometric(lms)
    return {
        "pitch": float(np.clip(pitch, -45, 45)),
        "yaw":   float(np.clip(yaw, -45, 45)),
        "roll":  float(np.clip(roll, -45, 45)),
    }

# ── Saudação: acenar para a peça começar ───────────────────────────────────
# A Regulação Sensorial espera por um aceno antes de acordar. Não é decoração:
# marca o instante em que aquela pessoa começa a sessão, e é a partir dele que
# as referências de repouso (`ReferenciaDeRepouso`) contam — sem isto, o repouso
# de quem se senta seria calculado sobre a sala vazia.
#
# A gramática do gesto é o que separa quem acena de quem passa: um aceno é uma
# oscilação **horizontal**, e é por isso que se contam inversões de direção e
# não distância percorrida. Passar a mão à frente da câmara percorre muito e não
# inverte nenhuma vez.
class DetectorDeAceno:
    """Deteta uma mão a acenar a partir da posição horizontal do pulso."""

    #: Meia-oscilação mínima, em fração da largura do frame. Abaixo disto é
    #: ruído de deteção da malha, não gesto: medido, o pulso treme ~0,005.
    AMPLITUDE_MIN = 0.025
    #: Inversões de direção necessárias. Cinco, porque é isso que a projeção
    #: conta: cada uma tira um quinto à cor que tapa a câmara, e a quinta
    #: descobre a pessoa. Abaixo de três já não se distinguia de um movimento
    #: acidental, e cinco continua a ser um gesto curto de fazer.
    INVERSOES = 5
    #: Perder a mão mais do que isto esquece o que estava contado — meio aceno
    #: de uma pessoa não pode somar-se ao meio aceno da seguinte.
    SEM_MAO_S = 0.6

    def __init__(self):
        self.limpar()

    def limpar(self):
        self._inversoes = 0
        self._extremo = None      # último ponto onde o movimento mudou de sentido
        self._sentido = 0         # -1, 0 ou +1
        self._visto = None        # instante em que a mão foi vista pela última vez

    @property
    def progresso(self):
        """0..1 — quanto do aceno já foi reconhecido. Para a barra na projeção."""
        return min(1.0, self._inversoes / self.INVERSOES)

    def atualizar(self, x, agora):
        """Alimenta a posição horizontal do pulso (`None` = sem mão).

        Devolve True no instante em que o aceno fica completo.
        """
        if x is None:
            if self._visto is not None and agora - self._visto > self.SEM_MAO_S:
                self.limpar()
            return False
        self._visto = agora
        if self._extremo is None:
            self._extremo = x
            return False

        desvio = x - self._extremo
        if abs(desvio) < self.AMPLITUDE_MIN:
            return False            # ainda não andou o suficiente para contar
        sentido = 1 if desvio > 0 else -1
        if sentido != self._sentido:
            # Mudou de sentido depois de percorrer o mínimo: é meia oscilação.
            if self._sentido != 0:
                self._inversoes += 1
            self._sentido = sentido
        self._extremo = x
        return self._inversoes >= self.INVERSOES


def pulso_x(rgb, estado):
    """Posição horizontal do pulso da mão mais visível, ou None se não houver.

    Carrega o MediaPipe Hands à primeira chamada e guarda-o em `estado`. Se o
    modelo não carregar, marca `falhou` — quem chama tem de deixar a peça
    arrancar à mesma, porque prender o visitante num ecrã que nunca passa é
    pior do que não ter saudação nenhuma.
    """
    if estado["falhou"]:
        return None
    if estado["modelo"] is None:
        try:
            from mediapipe.python.solutions import hands as mp_hands
            estado["modelo"] = mp_hands.Hands(
                static_image_mode=False,
                max_num_hands=1,          # basta uma: quem acena, acena com uma
                model_complexity=0,
                min_detection_confidence=0.6,
                min_tracking_confidence=0.5,
            )
        except Exception as ex:
            estado["falhou"] = True
            print(f"[SAUDACAO ERRO] MediaPipe Hands não carregou: {ex}", file=sys.stderr)
            return None
    try:
        res = estado["modelo"].process(rgb)
    except Exception:
        return None
    maos = (res.multi_hand_landmarks if res else None) or []
    if not maos:
        return None
    return float(maos[0].landmark[0].x)      # landmark 0 = pulso


def largar_hands(estado):
    """Fecha o modelo de mãos. A saudação acontece uma vez; ficar com o modelo
    carregado custava memória e ~5-15 ms por frame para o resto da sessão."""
    if estado["modelo"] is not None:
        try:
            estado["modelo"].close()
        except Exception:
            pass
        estado["modelo"] = None


# ── Linha de base das Action Units ─────────────────────────────────────────
# As AUs são medidas *relativas* a uma linha de base apanhada nos primeiros
# frames, por isso uma base enviesada envieza a sessão inteira. Medido: o
# componente facial da ativação tem mediana 0,003 num log gravado (morto) e
# 0,728 num ensaio ao vivo na mesma máquina (preso em cima) — ver `ATIV_PESOS`.
# Duas defesas, ambas baratas:
#   · só entram frames com a cara de frente. A abertura da pálpebra é uma
#     distância vertical na imagem: de cabeça baixa vê-se encurtada, a base sai
#     curta e olhos normais leem "arregalados" a sessão inteira. Yaw e roll
#     encurtam da mesma maneira a largura da boca e a abertura dos olhos.
#   · mediana em vez de média. Um pestanejo dura ~0,15 s e num minuto são ~5%
#     dos frames: puxava a média da abertura da pálpebra e do `openEAR` (que dá
#     o limiar do próprio pestanejo) para baixo. A mediana ignora-os.
# Os limites são geométricos, não psicofisiológicos: acima deles a métrica que
# se está a medir já não é a mesma grandeza. Não há aqui nenhuma afirmação sobre
# o significado emocional das AUs.
CALIB_POSE_MAX = {"pitch": 12.0, "yaw": 15.0, "roll": 15.0}
# Sem frames de frente que cheguem, fecha-se na mesma ao fim deste tempo: uma
# base imperfeita é melhor do que o motor ficar preso a calibrar para sempre.
CALIB_TIMEOUT_S = 20.0


def frame_calibravel(pose):
    """A cara está de frente o suficiente para servir de linha de base?"""
    return all(abs(pose[eixo]) <= limite for eixo, limite in CALIB_POSE_MAX.items())


def fechar_calibracao(buffer, baselines):
    """Fixa cada linha de base na mediana dos frames aceites.

    Sem frames aceites, mantém os valores por defeito — devolve False para quem
    chama poder dizê-lo em vez de fingir que calibrou.
    """
    if not buffer:
        return False
    for key in baselines:
        vals = [d[key] for d in buffer if key in d]
        if vals:
            baselines[key] = float(np.median(vals))
    return True

# ═══════════════════════════════════════════════════════════
# SENSORES DE SALA — fluxo ótico global · presença multi-pessoa · gestos macro
# Correm sobre o frame inteiro (com ou sem rosto); emitidos na chave "room".
# ═══════════════════════════════════════════════════════════
room_state = {
    "prev_gray": None, "energy": 0.0, "flow": [0.0, 0.0], "flow_field": None,
    "count": 0, "people": [],
    "arms": False, "crouch": False, "hip_baseline": None,
    "i": 0, "face_det": None, "pose_model": None,
}

def _update_flow(frame_bgr):
    gray = cv2.cvtColor(cv2.resize(frame_bgr, (160, 120)), cv2.COLOR_BGR2GRAY)
    prev = room_state["prev_gray"]
    room_state["prev_gray"] = gray
    if prev is None:
        return
    flow = cv2.calcOpticalFlowFarneback(prev, gray, None, 0.5, 2, 15, 2, 5, 1.1, 0)
    # Campo completo guardado para o ambiente Fluid AI, onde é o movimento
    # filmado que agita o fluido. Os sensores da sala só usam a média.
    room_state["flow_field"] = flow
    mag = np.hypot(flow[..., 0], flow[..., 1])
    energy_raw = clamp(float(mag.mean()) / 4.0)
    # Vetor médio normalizado a ~8 px/frame = movimento rápido (escala empírica)
    mean_vec = flow.mean(axis=(0, 1)) / 8.0
    a = 0.3
    room_state["energy"] = (1 - a) * room_state["energy"] + a * energy_raw
    room_state["flow"][0] = clamp((1 - a) * room_state["flow"][0] + a * float(mean_vec[0]), -1.0, 1.0)
    room_state["flow"][1] = clamp((1 - a) * room_state["flow"][1] + a * float(mean_vec[1]), -1.0, 1.0)

def _update_presence(rgb):
    if room_state["face_det"] is None:
        from mediapipe.python.solutions import face_detection as mp_face_detection
        room_state["face_det"] = mp_face_detection.FaceDetection(
            model_selection=1, min_detection_confidence=0.5)
    res = room_state["face_det"].process(rgb)
    people = []
    for det in (res.detections or []):
        box = det.location_data.relative_bounding_box
        people.append({
            "x": round(clamp(box.xmin + box.width / 2), 3),
            "y": round(clamp(box.ymin + box.height / 2), 3),
            "s": round(clamp(box.width), 3),
        })
    people.sort(key=lambda p: p["s"], reverse=True)
    room_state["people"] = people[:6]
    room_state["count"] = len(people)

def _update_gesture(rgb):
    if room_state["pose_model"] is None:
        from mediapipe.python.solutions import pose as mp_pose_sol
        room_state["pose_model"] = mp_pose_sol.Pose(
            model_complexity=0, min_detection_confidence=0.5, min_tracking_confidence=0.5)
    res = room_state["pose_model"].process(rgb)
    lm = res.pose_landmarks.landmark if res.pose_landmarks else None
    arms = False
    crouch = room_state["crouch"]
    if lm:
        def vis(i): return lm[i].visibility > 0.5
        # 11/12 = ombros, 15/16 = pulsos, 23/24 = ancas
        if vis(11) and vis(12) and vis(15) and vis(16):
            shoulder_w = abs(lm[11].x - lm[12].x)
            arms = shoulder_w > 0.01 and abs(lm[15].x - lm[16].x) > 1.6 * shoulder_w
        if vis(23) and vis(24):
            hip_y = (lm[23].y + lm[24].y) / 2
            base = room_state["hip_baseline"]
            if base is None:
                room_state["hip_baseline"] = hip_y
            else:
                if not crouch:
                    room_state["hip_baseline"] = 0.99 * base + 0.01 * hip_y
                base = room_state["hip_baseline"]
                # Histerese: liga a +0.10, desliga a +0.06 abaixo da baseline
                if hip_y > base + 0.10:
                    crouch = True
                elif hip_y < base + 0.06:
                    crouch = False
    else:
        crouch = False
    room_state["arms"] = arms
    room_state["crouch"] = crouch

def update_room(frame_bgr, rgb):
    # Exceções nunca sobem — o loop principal alberga o áudio, que não pode parar.
    # Cada sensor tem o seu próprio try/except: uma falha num (ex.: gesto, menos
    # testado em produção) não pode apagar os outros dois do payload.
    room_state["i"] += 1
    i = room_state["i"]
    room = {}
    if active_sensors.get("flow", True):
        try:
            if i % 2 == 0:
                _update_flow(frame_bgr)
            room["energy"] = round(room_state["energy"], 3)
            room["flow"] = [round(room_state["flow"][0], 4), round(room_state["flow"][1], 4)]
        except Exception as e:
            print(f"[ROOM ERRO][flow] {e}", file=sys.stderr)
    if active_sensors.get("presence", True):
        try:
            if i % 5 == 0:
                _update_presence(rgb)
            room["count"] = room_state["count"]
            room["people"] = room_state["people"]
        except Exception as e:
            print(f"[ROOM ERRO][presence] {e}", file=sys.stderr)
    if active_sensors.get("gesture", False):
        try:
            if i % 2 == 0:
                _update_gesture(rgb)
            room["gesture"] = {"arms": room_state["arms"], "crouch": room_state["crouch"]}
        except Exception as e:
            print(f"[ROOM ERRO][gesture] {e}", file=sys.stderr)
    return room

def compute_symmetry(lms):
    pairs = [(33, 263), (55, 285), (70, 300), (61, 291), (159, 386), (145, 374)]
    center_x = lms[NOSE_TIP][0]
    total_diff = 0.0
    for l_idx, r_idx in pairs:
        d_l = abs(lms[l_idx][0] - center_x)
        d_r = abs(lms[r_idx][0] - center_x)
        total_diff += abs(d_l - d_r)
    return max(0.0, 1.0 - total_diff * 8)

# ── Estimativa de distancia por semelhanca de triangulos ────────────────────
# Metodo classico de camara unica (ver Asadullah-Dal17/Distance_measurement_
# using_single_camera): com a largura real de um objeto conhecida e a distancia
# focal em pixeis, distancia = (largura_real * focal) / largura_em_pixeis.
#
# LIMITACOES, a nao esconder na UI:
#  - Assume uma largura facial fixa. A largura bizigomatica adulta varia
#    tipicamente ~13-15 cm consoante sexo e ascendencia, pelo que o erro
#    individual pode chegar facilmente aos 10-15%.
#  - Assume o rosto de frente. Cabeca rodada encurta a largura projetada e a
#    distancia aparece sobrestimada.
#  - A focal por omissao vem de um campo de visao horizontal assumido de 60,
#    valor comum em webcams mas nao medido. Calibrar com CALIBRATE_DISTANCE
#    substitui esta suposicao por uma medida real desta camara.
# E uma ESTIMATIVA, nao uma medicao. Nunca apresentar como distancia exata.
# Intervalo entre cálculos de BPM por rPPG. O algoritmo POS (Wang et al., 2017,
# IEEE Trans. Biomed. Eng. 64(7):1479-1491) trabalha sobre uma janela deslizante
# de vários segundos; correr essa janela inteira a cada frame não acrescenta
# informação, apenas repete o cálculo. 1 s é bastante mais rápido do que a
# escala a que a frequência cardíaca varia.
RPPG_INTERVALO_S = 1.0


# ═══════════════════════════════════════════════════════════
# ATIVAÇÃO — eixo vertical do plano de Russell
# ═══════════════════════════════════════════════════════════
# Medido sobre 13 321 frames com rosto de sessões reais (sensus_engine.log,
# 2026-09-01), a fórmula anterior — `au26*0,3 + au5*0,5` — **nunca** passou de
# 0,343 num eixo cuja fronteira é 0,5: a metade superior do plano era
# inalcançável, 0,00% do tempo. O eixo da valência não tem o problema (vai de
# -0,64 a +0,99 e reparte-se 48/52 pelos dois quadrantes de baixo).
#
# A causa está na escolha de sinais, não nos ganhos: AU5 (pálpebra superior
# levantada) tem mediana 0,000 e máximo 0,470; AU26 (queixo descaído) tem
# mediana 0,001. Uma cara composta dá ativação zero por muito ativada que a
# pessoa esteja, e só uma expressão de sobressalto teatral cruzaria 0,5.
#
# Passa a combinar três sinais que o motor já media e não usava aqui:
#   - **cardíaco** — BPM do rPPG acima do repouso da própria pessoa. Amplitude
#     observada 67–135 bpm, desvio 12,2: de longe o sinal com mais dinâmica.
#   - **movimento** — energia do fluxo ótico da sala.
#   - **rosto** — as AUs de antes, agora com peso menor por serem quase sempre
#     nulas.
#
# RIGOR CIENTÍFICO: a associação entre atividade cardíaca e a dimensão de
# ativação é corrente em psicofisiologia, mas **estes pesos e este mapeamento
# são heurísticas sem validação publicada**, exatamente como os anteriores — ver
# a auditoria de sensores de 2026-07-24. A saída não pode ser descrita como uma
# medida validada, nem no código nem na interface.


class ReferenciaDeRepouso:
    """Quanto um sinal está acima do repouso da própria pessoa, em 0..1.

    O repouso é por pessoa e por sala — 70 bpm num visitante são 95 noutro, e a
    energia do fluxo ótico depende da luz, do enquadramento e de quanta gente
    passa — por isso tem de ser estimado, não fixado. Mas **não pode ser um
    percentil de janela**: um percentil segue o sinal quando ele tem tendência, e
    os dois defeitos que isso deu foram ambos medidos, não imaginados:

    - com amplitude também percentil (p05→p85), num troço em que o BPM sobe de
      65 para 85 o valor atual é sempre o máximo do que se viu: o componente
      cardíaco ficou com mediana **1,000** e a ativação passou 74,5% do tempo na
      metade superior;
    - com amplitude fixa mas repouso no p05 de 3 min, num troço em que o BPM
      desce de 127 para 89 o p05 é sempre o valor atual: o componente ficou
      preso em **0,00** durante os 200 s inteiros.

    Aqui o repouso é um **quantil seguido a passo fixo**: sobe quando o sinal
    está acima dele, desce quando está abaixo, e os dois passos são desiguais,
    por isso assenta onde `QUANTIL` da distribuição da pessoa fica por baixo.
    Não é o mínimo visto, e é essa a diferença que conta: um piso que persegue o
    mínimo transforma qualquer valor normal numa ativação, porque o normal está
    sempre acima do mínimo.

    Foi o defeito medido a 2026-09-17. Com o piso a descer em 5 s atrás de
    qualquer leitura mais baixa e a subir 0,6 bpm/min, **30 s de rPPG mau**
    (rosto de lado, luz a mudar) deixavam-no 20 bpm abaixo do repouso real e o
    componente cardíaco ficava em **1,000 o resto da sessão** — 100% do tempo na
    metade de cima do plano, que é o sintoma de que a peça estava presa em cima.
    Com o quantil, o mesmo episódio move o piso 1,5 bpm.

    Assim uma pessoa a acalmar vê o eixo descer e uma pessoa a ativar-se vê-o
    subir — que é o que a peça quer mostrar —, e continua a valer que uma
    ativação sustentada não se torna o novo normal a meio de uma sessão: a
    subida é quatro vezes mais lenta do que a descida.

    A amplitude (`faixa`) é fixa e em unidades do sinal: o eixo diz "tantos bpm
    acima do teu repouso", e não "onde estás na tua própria distribuição".

    Devolve None enquanto não houver amostras que cheguem para fixar o repouso.

    ponytail: dois números e duas constantes; a única ordenação acontece uma
    vez, no fim do aquecimento.
    """

    #: Quantil do sinal da própria pessoa onde o piso assenta: um quinto do que
    #: ela mostra fica abaixo do seu repouso. Baixo que chegue para o eixo ter
    #: margem para subir, alto que chegue para o ruído não o definir.
    QUANTIL = 0.2
    #: Passo por amostra, em fração da `faixa`. A 20 fps e na referência
    #: cardíaca (faixa 15 bpm) dá 3 bpm/min a descer e 0,75 a subir — a
    #: assimetria sai do quantil, não de duas taxas escolhidas à mão.
    PASSO = 1.0 / 4800.0

    def __init__(self, faixa, minimo):
        self.faixa = faixa
        self.minimo = minimo
        self._n = 0
        self._repouso = None
        self._aquecimento = []

    def limpar(self):
        self._n = 0
        self._repouso = None
        self._aquecimento = []

    def atualizar(self, v):
        self._n += 1
        if self._repouso is None:
            # Aquecimento: guarda e não reporta nada. No fim, o piso nasce já no
            # quantil das amostras recolhidas. Nascer no mínimo obrigava-o a
            # subir 0,75 bpm/min até ao sítio certo e a sessão acabava antes.
            self._aquecimento.append(v)
            if self._n < self.minimo:
                return None
            ordenadas = sorted(self._aquecimento)
            self._repouso = ordenadas[int(self.QUANTIL * (len(ordenadas) - 1))]
            self._aquecimento = []
        else:
            passo = self.faixa * self.PASSO
            self._repouso += passo * (self.QUANTIL if v > self._repouso
                                      else -(1.0 - self.QUANTIL))
        return clamp((v - self._repouso) / self.faixa)


# Pesos do movimento e do rosto. **Não são votos numa média** — ver
# `calcular_ativacao`: o cardíaco define o eixo e estes dois só empurram para
# cima. O que se passava antes, com uma média ponderada dos três:
#
#   uma pessoa sentada e quieta, com o componente cardíaco já saturado em 1,0,
#   tinha um teto de 0,55 + 0,30×0,05 = **0,565** — e a fronteira do quadrante
#   superior é 0,50, com histerese de 0,05. Sobrava uma margem de 0,015.
#
# Ou seja: numa peça cujo propósito é a pessoa estar quieta a regular-se, a
# imobilidade valia 30% de voto em "calmo" e tapava o eixo. O sinal de que a
# estrutura estava errada era este: **desligar** o sensor de fluxo renormalizava
# os pesos e *subia* o teto de 0,565 para 0,786.
#
# Estar parado não é estar calmo, e uma cara composta não é uma cara calma — as
# AUs estão a zero em 90% dos frames, medido. Nenhum dos dois é evidência de
# calma; ambos são evidência *positiva* de ativação quando aparecem.
#
# O rosto leva o peso mais baixo por ser o menos fiável dos três, medido nos dois
# sentidos: nos 13 321 frames gravados o componente facial tem mediana 0,003
# (morto), e num ensaio ao vivo na mesma máquina tem mediana 0,728 (preso em
# cima). A diferença é a calibração de 60 frames das AUs — o AU5 é a abertura da
# pálpebra *relativa à linha de base*, e se essa base for apanhada com a pessoa a
# olhar para baixo, os olhos normais passam a ler "arregalados" a sessão inteira.
#
# Essa calibração ganhou entretanto duas defesas — porta de pose e mediana, ver
# `frame_calibravel` — mas o peso mantém-se em 0,15: a melhoria está verificada
# em teste, **não** numa nova medição ao vivo. Só uma sessão gravada com o
# `aro_comp` do rosto de volta perto da mediana dos outros componentes justifica
# subir isto.
#
# Quanto cada um pode empurrar a ativação para cima, no máximo. O cardíaco não
# está aqui de propósito: não é um peso, é o próprio eixo.
#
# **O teto é o que interessa aqui, não os ganhos.** Até 2026-09-17 a soma dava
# 0,45 e a fronteira para *entrar* no quadrante ativado é 0,55 (0,50 mais a
# histerese): uma pessoa a mexer-se depressa e sem parar, com as AUs no máximo,
# chegava a **0,450** exatos e o quadrante nunca virava. Medido, não deduzido. A
# peça só sabia ver agitação pelo coração — e o rPPG de quem se mexe muito é
# precisamente o mais ruidoso.
#
# Agora somam 0,97. O movimento sozinho e saturado vale 0,60 e atravessa a
# fronteira por si: mexer-se depressa e sem parar É um estado agitado, mesmo com
# o batimento no próprio repouso. O cardíaco continua a ser o eixo — é o único
# bidirecional, o único que faz a ativação *descer* — mas deixou de ser condição
# necessária para a peça reconhecer agitação.
#
# O rosto mantém 0,15 pelo motivo de sempre: é o menos fiável dos quatro e a sua
# calibração ainda não foi revalidada ao vivo.
ATIV_PESOS = {"movimento": 0.60, "rosto": 0.15, "piscar": 0.22}

# Cardíaco: **15 bpm** acima do repouso da própria pessoa saturam o eixo.
#
# Era 25, escolhido pela amplitude *entre* sessões dos logs (67–135 bpm). Mas o
# eixo mede a variação **dentro** de uma sessão, de uma pessoa sentada, e essa é
# muito menor: medido sobre a `ReferenciaDeRepouso` real, uma subida sustentada
# de +10 bpm dava um componente de 0,39 e um pico de ativação de 0,20 — a peça
# nunca via a pessoa ativar-se.
#
# 15 bpm é uma escolha ancorada em duas coisas, e continua a ser uma heurística:
#  - o desvio de 12,2 bpm medido nos próprios logs do motor;
#  - a ordem de grandeza da reatividade cardíaca a stressores psicológicos
#    agudos em laboratório, ~+11 bpm num stressor moderado (Huang et al., 2013,
#    Front. Physiol. 4:314, doi:10.3389/fphys.2013.00314, revisão), sendo que
#    uma sessão de regulação é mais suave do que um stressor de laboratório.
# Ensaiadas 25/20/15/12/10: com 15 uma subida moderada chega ao quadrante
# superior com pico 0,82 (fica resolução por cima) e o repouso não sobe de 0,15;
# com 10 a mesma subida encravava em 1,00.
#
# RIGOR: este número **não está validado numa sessão real gravada** — a
# validação está pendente e é a tarefa aberta de 2026-09-07.
# Aquecimento de 400 amostras (~20 s a 20 fps) antes de reportar.
#
# Movimento: o valor já vem comprimido por raiz quadrada (ver `calcular_ativacao`),
# por isso a amplitude é em unidades de √energia. 0,13 põe o p90 observado
# (√0,045 = 0,212, contra um repouso de √0,007 = 0,084) no topo da escala.
#
# Pestanejo: **12 pestanejos/min** acima do repouso da própria pessoa saturam o
# componente. A taxa espontânea em repouso varia muito de pessoa para pessoa
# (daí ser, como as outras, relativa ao próprio), e é por isso que o que entra
# aqui é o aumento e não o valor absoluto.
#
# RIGOR: que a taxa de pestanejo espontâneo acompanha estados de ativação e de
# stress é associação corrente em psicofisiologia, mas **este mapeamento é uma
# heurística sem validação publicada**, exatamente como os outros três. Nem o
# código nem a interface a podem descrever como medida validada.
_ativacao = {
    "bpm": ReferenciaDeRepouso(faixa=15.0, minimo=400),
    "mov": ReferenciaDeRepouso(faixa=0.13, minimo=200),
    "piscar": ReferenciaDeRepouso(faixa=12.0, minimo=200),
}

#: Janela de contagem do pestanejo, em segundos. 20 s é o compromisso: mais
#: curto e a taxa passa a saltar 3/min por cada pestanejo contado; mais longo e
#: uma pessoa que se agita a meio da sessão demora a aparecer.
PISCAR_JANELA_S = 20.0
_piscar = {"marcas": deque(), "desde": None}


def registar_piscar(agora=None):
    """Regista um pestanejo. Chamado pelo detetor de EAR, uma vez por pestanejo."""
    agora = time.time() if agora is None else agora
    if _piscar["desde"] is None:
        _piscar["desde"] = agora
    _piscar["marcas"].append(agora)


def taxa_de_piscar(agora=None):
    """Pestanejos por minuto na última janela, ou None enquanto ela não encheu.

    Devolver None e não zero é deliberado: no primeiro segundo de sessão ninguém
    pestanejou ainda, e um zero faria a referência de repouso assentar em zero —
    a partir daí qualquer pestanejo leria como ativação.
    """
    agora = time.time() if agora is None else agora
    marcas = _piscar["marcas"]
    while marcas and agora - marcas[0] > PISCAR_JANELA_S:
        marcas.popleft()
    if _piscar["desde"] is None or agora - _piscar["desde"] < PISCAR_JANELA_S:
        return None
    return round(len(marcas) * (60.0 / PISCAR_JANELA_S), 1)


def redefinir_piscar():
    """Esquece o histórico de pestanejo. Chamado ao carregar uma exposição."""
    _piscar["marcas"].clear()
    _piscar["desde"] = None
    _ativacao["piscar"].limpar()


def calcular_ativacao(bpm, energia_movimento, au5, au26, taxa_piscar=None,
                      usa_movimento=True):
    """Ativação 0..1: o cardíaco define o eixo; movimento, pestanejo e rosto empurram.

    Não é uma média ponderada dos quatro — ver `ATIV_PESOS`. O componente
    cardíaco é o único bidirecional (o BPM tanto sobe como desce em relação ao
    repouso da própria pessoa), por isso é ele que define o eixo. Os outros três
    são esparsos e só dizem alguma coisa quando aparecem: somam, nunca subtraem.

    O que mudou a 2026-09-17 não foi a estrutura, foi o **teto**: os empurrões
    somavam 0,45 contra uma fronteira em 0,55, e por isso nenhuma quantidade de
    agitação visível chegava para mudar de quadrante sem o coração alinhar.

    Sem cardíaco (rPPG ainda a aquecer), os que sobram repartem o eixo inteiro
    entre si, para a ativação não ficar presa em baixo no arranque.
    """
    cardiaco = _ativacao["bpm"].atualizar(bpm) if bpm and bpm > 0 else None
    # Raiz quadrada antes de normalizar: a energia do fluxo ótico tem cauda
    # muito longa (mediana 0,009 contra máximo 0,381) e o mapa linear punha a
    # mediana do componente em 0,09 — quase sempre desligado.
    movimento = (_ativacao["mov"].atualizar(math.sqrt(max(0.0, energia_movimento)))
                 if usa_movimento else None)
    # Ganhos contidos, próximos dos originais: com 1,5 e 0,8 o termo facial
    # saturava em 1,0 durante sessões inteiras quando a linha de base das AUs
    # saía mal calibrada — ver `ATIV_PESOS`.
    rosto = clamp(au5 * 1.0 + au26 * 0.6)
    # Pestanejo: quantos por minuto acima do repouso da própria pessoa. Vem do
    # frame anterior — o detetor de EAR corre depois disto no ciclo — e 50 ms de
    # atraso não contam numa taxa por minuto.
    piscar = _ativacao["piscar"].atualizar(taxa_piscar) if taxa_piscar is not None else None

    empurra = ((ATIV_PESOS["movimento"], movimento), (ATIV_PESOS["rosto"], rosto),
               (ATIV_PESOS["piscar"], piscar))
    extra = sum(p * v for p, v in empurra if v is not None)
    comp = {"cardiaco": cardiaco, "movimento": movimento, "rosto": rosto,
            "piscar": piscar}
    if cardiaco is None:
        # Ainda sem batimento: os que sobram repartem o eixo todo entre si.
        peso = sum(p for p, v in empurra if v is not None)
        return (clamp(extra / peso) if peso else 0.0), comp
    return clamp(cardiaco + extra), comp


# Os quatro quadrantes do modelo circumplexo de Russell (1980, J. Pers. Soc.
# Psychol. 39(6):1161-1178): valência no eixo horizontal, ativação no vertical.
# Nomes em código, para as prompts serem endereçáveis por quadrante.
_QUADRANTES = ("ativado_positivo", "ativado_negativo", "calmo_positivo", "calmo_negativo")


# Margem de histerese e tempo mínimo no mesmo quadrante antes de o assumir.
#
# O comentário anterior dizia que não havia histerese porque "val/aro já vêm
# suavizados" e uma zona morta prenderia o quadrante. Medido no log real, o que
# acontecia era o contrário: **15,1 trocas de quadrante por minuto**, permanência
# mediana de 0,4 s e mínima de 0,05 s — a mediana da valência é -0,021, ou seja
# está praticamente em cima da fronteira, e o quadrante saltava com o ruído. Cada
# salto troca a prompt, o que reencoda o texto pelo CLIP (30 ms) e dá um salto
# visível na imagem gerada.
#
# Ensaiadas sete combinações sobre os mesmos frames. Esta (histerese + 1,5 s):
#   1,4 trocas/min · permanência mediana 9,7 s · mínima 1,85 s · 15,5% de atraso
# contra 17,3 trocas/min e mediana 0,7 s sem proteção nenhuma. Só permanência
# mínima de 3 s dava estabilidade parecida mas com mediana de 21 s, lento demais
# para uma peça que reage ao corpo.
ATIV_HISTERESE_VAL = 0.08
ATIV_HISTERESE_ARO = 0.05
ATIV_PERMANENCIA_S = 1.5

_quadrante_estado = {"atual": None, "candidato": None, "desde": 0.0}


def redefinir_quadrante():
    """Esquece o quadrante fixado. Chamado ao carregar uma exposição."""
    _quadrante_estado.update({"atual": None, "candidato": None, "desde": 0.0})


def quadrante_russell(estado, agora=None):
    """Em que quadrante do plano está o estado atual.

    Fronteiras em val=0 e aro=0.5, que é o centro do intervalo em que a ativação
    é reportada (0..1), com histerese à volta delas e um tempo mínimo de
    permanência antes de assumir um quadrante novo — ver as constantes acima.
    """
    agora = time.time() if agora is None else agora
    val = estado.get("val", 0.0)
    aro = estado.get("aro", 0.5)
    atual = _quadrante_estado["atual"]

    if atual is None:
        bruto = ("ativado" if aro >= 0.5 else "calmo") + ("_positivo" if val >= 0.0 else "_negativo")
        _quadrante_estado.update({"atual": bruto, "candidato": bruto, "desde": agora})
        return bruto

    # A fronteira afasta-se do lado onde já se está: sair custa mais do que ficar.
    positivo = val >= (-ATIV_HISTERESE_VAL if atual.endswith("positivo") else ATIV_HISTERESE_VAL)
    ativado = aro >= (0.5 - ATIV_HISTERESE_ARO if atual.startswith("ativado") else 0.5 + ATIV_HISTERESE_ARO)
    bruto = ("ativado" if ativado else "calmo") + ("_positivo" if positivo else "_negativo")

    if bruto == atual:
        _quadrante_estado["candidato"] = atual
        return atual
    if bruto != _quadrante_estado["candidato"]:
        _quadrante_estado.update({"candidato": bruto, "desde": agora})
    elif agora - _quadrante_estado["desde"] >= ATIV_PERMANENCIA_S:
        _quadrante_estado["atual"] = bruto
        return bruto
    return atual


def denoising_por_ativacao(aro, base):
    """Menos ativação → mais denoising; mais ativação → menos.

    Pedido explícito: o visual afasta-se mais da câmara quando a pessoa está
    calma, e cola-se mais a ela quando está ativada. `base` é o valor do painel,
    que passa a ser o ponto médio da faixa em vez de um valor fixo.
    """
    a = max(0.0, min(1.0, aro))
    return max(0.10, min(0.95, base + AMPLITUDE_DENOISING * (0.5 - a) * 2.0))


# Quanto o denoising se afasta do valor do painel nos extremos da ativação.
AMPLITUDE_DENOISING = 0.22

# Deslocamento máximo, em píxeis por frame na grelha de 160×120 do fluxo ótico,
# que se mapeia para o extremo da escala ao enviar o campo de movimento. Acima
# disto satura. 8 px/frame corresponde a um gesto rápido à frente da câmara.
FLUXO_MAX = 8.0

LARGURA_FACIAL_ASSUMIDA_CM = 14.3
FOV_HORIZONTAL_ASSUMIDO_GRAUS = 60.0
_FACE_ESQ_IDX, _FACE_DIR_IDX = 234, 454   # bordos das faces no FaceMesh

distance_calib = {"focal_px": None, "fonte": None}   # fonte: rosto | tabuleiro


def _largura_face_px(lms, w_img):
    """Largura projetada do rosto, em pixeis. None se os landmarks faltarem."""
    try:
        return abs(lms[_FACE_DIR_IDX][0] - lms[_FACE_ESQ_IDX][0]) * w_img
    except (IndexError, TypeError):
        return None


def _focal_px(w_img):
    if distance_calib["focal_px"]:
        return distance_calib["focal_px"]
    meio_fov = math.radians(FOV_HORIZONTAL_ASSUMIDO_GRAUS / 2.0)
    return (w_img / 2.0) / math.tan(meio_fov)


def estimar_distancia_cm(lms, w_img):
    """Distancia estimada camara-rosto, em cm. None se nao for calculavel."""
    largura_px = _largura_face_px(lms, w_img)
    if not largura_px or largura_px < 1.0:
        return None
    d = (LARGURA_FACIAL_ASSUMIDA_CM * _focal_px(w_img)) / largura_px
    if not (10.0 <= d <= 600.0):   # fora deste intervalo e ruido, nao medida
        return None
    return round(d, 1)


def calibrar_distancia(lms, w_img, distancia_real_cm):
    """Deriva a focal desta camara a partir de uma distancia real conhecida."""
    largura_px = _largura_face_px(lms, w_img)
    if not largura_px or largura_px < 1.0 or distancia_real_cm <= 0:
        return False
    distance_calib["focal_px"] = (largura_px * distancia_real_cm) / LARGURA_FACIAL_ASSUMIDA_CM
    distance_calib["fonte"] = "rosto"
    _guardar_calibracao(distance_calib["focal_px"], "rosto")
    return True


# ── Calibracao intrinseca por tabuleiro de xadrez (opcional) ────────────────
# Metodo de Zhang (Zhang, 2000, "A Flexible New Technique for Camera
# Calibration", IEEE TPAMI), via cv2.calibrateCamera.
#
# Porque e melhor que a calibracao rapida por rosto: a calibracao por rosto
# resolve uma equacao com DUAS incognitas (focal da camara e largura facial do
# individuo) assumindo a segunda. Todo o erro da largura facial real fica
# absorvido no valor da focal — fica certo para essa pessoa, errado para outras.
# O tabuleiro tem geometria conhecida e mede a focal independentemente de
# qualquer rosto, deixando so a largura facial por assumir.
#
# Nota: a focal em pixeis nao depende da escala do padrao no mundo real, pelo
# que os quadrados nao precisam de ser medidos — usam-se unidades arbitrarias.
CALIB_FICHEIRO = os.path.join(script_dir, "camera_calibration.json")

chessboard_calib = {
    "ativa": False,
    "padrao": (9, 6),        # cantos INTERNOS, nao quadrados
    "alvo": 15,              # vistas a recolher
    "objpoints": [],
    "imgpoints": [],
    "ultimo_t": 0.0,
    "estado": "idle",        # idle | a_recolher | a_calcular | pronto | erro
    "mensagem": "",
}


def _guardar_calibracao(focal_px, fonte):
    try:
        with open(CALIB_FICHEIRO, "w", encoding="utf-8") as f:
            json.dump({"focal_px": focal_px, "fonte": fonte}, f)
    except Exception as ex:
        print(f"[CALIB] Nao foi possivel guardar: {ex}", file=sys.stderr)


def carregar_calibracao():
    """Le uma calibracao anterior, se existir. Chamado uma vez no arranque."""
    try:
        if os.path.exists(CALIB_FICHEIRO):
            with open(CALIB_FICHEIRO, "r", encoding="utf-8") as f:
                d = json.load(f)
            if d.get("focal_px"):
                distance_calib["focal_px"] = float(d["focal_px"])
                distance_calib["fonte"] = d.get("fonte")
                chessboard_calib["estado"] = "pronto"
                chessboard_calib["mensagem"] = f"calibracao guardada ({d.get('fonte', '?')})"
                print(f"[CALIB] Calibracao carregada: {d['focal_px']:.1f} px "
                      f"({d.get('fonte', '?')})", file=sys.stderr)
    except Exception as ex:
        print(f"[CALIB] Ficheiro de calibracao ilegivel: {ex}", file=sys.stderr)


def _calcular_calibracao_thread(tamanho_img):
    """Corre cv2.calibrateCamera fora do loop principal (pode demorar segundos)."""
    def _trabalho():
        try:
            # cv2.calibrateCamera devolve o ERRO RMS de reprojecao, nao um
            # booleano. Valores abaixo de ~1 px sao considerados bons; acima
            # disso as vistas eram poucas ou pouco variadas.
            rms, mtx, dist, _, _ = cv2.calibrateCamera(
                chessboard_calib["objpoints"], chessboard_calib["imgpoints"],
                tamanho_img, None, None)
            fx = float(mtx[0][0])
            if not (50.0 < fx < 10000.0):
                raise RuntimeError(f"focal implausivel ({fx:.0f} px)")
            if rms > 1.5:
                raise RuntimeError(f"erro de reprojecao alto ({rms:.2f} px) — "
                                   "repetir com mais angulos")
            distance_calib["focal_px"] = fx
            distance_calib["fonte"] = "tabuleiro"
            _guardar_calibracao(fx, "tabuleiro")
            chessboard_calib["estado"] = "pronto"
            chessboard_calib["mensagem"] = f"focal medida: {fx:.0f} px (erro {rms:.2f} px)"
            print(f"[CALIB] Tabuleiro concluido. fx={fx:.1f} fy={mtx[1][1]:.1f} "
                  f"rms={rms:.3f}", file=sys.stderr)
        except Exception as ex:
            chessboard_calib["estado"] = "erro"
            chessboard_calib["mensagem"] = str(ex)[:80]
            print(f"[CALIB] Falhou: {ex}", file=sys.stderr)
        finally:
            chessboard_calib["ativa"] = False
            chessboard_calib["objpoints"] = []
            chessboard_calib["imgpoints"] = []
    threading.Thread(target=_trabalho, daemon=True).start()


def processar_frame_tabuleiro(frame_bgr):
    """Recolhe uma vista do tabuleiro, se houver. Chamado por frame quando ativo."""
    if not chessboard_calib["ativa"]:
        return
    agora = time.time()
    if agora - chessboard_calib["ultimo_t"] < 0.7:   # evita vistas quase iguais
        return
    cols, rows = chessboard_calib["padrao"]
    cinza = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    achou, cantos = cv2.findChessboardCorners(
        cinza, (cols, rows),
        cv2.CALIB_CB_ADAPTIVE_THRESH + cv2.CALIB_CB_NORMALIZE_IMAGE + cv2.CALIB_CB_FAST_CHECK)
    if not achou:
        return
    criterio = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)
    cantos = cv2.cornerSubPix(cinza, cantos, (11, 11), (-1, -1), criterio)
    objp = np.zeros((rows * cols, 3), np.float32)
    objp[:, :2] = np.mgrid[0:cols, 0:rows].T.reshape(-1, 2)
    chessboard_calib["objpoints"].append(objp)
    chessboard_calib["imgpoints"].append(cantos)
    chessboard_calib["ultimo_t"] = agora
    n = len(chessboard_calib["imgpoints"])
    print(f"[CALIB] Vista {n}/{chessboard_calib['alvo']} capturada.", file=sys.stderr)
    if n >= chessboard_calib["alvo"]:
        chessboard_calib["estado"] = "a_calcular"
        _calcular_calibracao_thread(cinza.shape[::-1])


def compute_gaze(lms):
    # Left eye Gaze
    # corners: 33 (outer) and 133 (inner)
    # top/bottom: 159 (top) and 145 (bottom)
    l_iris = lms[468]
    l_outer = lms[33]
    l_inner = lms[133]
    l_top = lms[159]
    l_bottom = lms[145]
    
    # Right eye Gaze
    # corners: 362 (inner) and 263 (outer)
    # top/bottom: 386 (top) and 374 (bottom)
    r_iris = lms[473]
    r_outer = lms[263]
    r_inner = lms[362]
    r_top = lms[386]
    r_bottom = lms[374]
    
    # Calculate Gaze relative to eye boundaries
    l_mid_x = (l_outer[0] + l_inner[0]) / 2.0
    l_mid_y = (l_top[1] + l_bottom[1]) / 2.0
    l_w = abs(l_outer[0] - l_inner[0])
    l_h = abs(l_top[1] - l_bottom[1])
    
    l_gaze_x = (l_iris[0] - l_mid_x) / (l_w * 0.5) if l_w > 0 else 0.0
    l_gaze_y = (l_iris[1] - l_mid_y) / (l_h * 0.5) if l_h > 0 else 0.0
    
    # Right eye center
    r_mid_x = (r_outer[0] + r_inner[0]) / 2.0
    r_mid_y = (r_top[1] + r_bottom[1]) / 2.0
    r_w = abs(r_outer[0] - r_inner[0])
    r_h = abs(r_top[1] - r_bottom[1])
    
    r_gaze_x = (r_iris[0] - r_mid_x) / (r_w * 0.5) if r_w > 0 else 0.0
    r_gaze_y = (r_iris[1] - r_mid_y) / (r_h * 0.5) if r_h > 0 else 0.0
    
    # Combine gaze vectors
    gaze_x = (l_gaze_x + r_gaze_x) / 2.0
    gaze_y = (l_gaze_y + r_gaze_y) / 2.0
    
    return float(np.clip(gaze_x, -1.0, 1.0)), float(np.clip(gaze_y, -1.0, 1.0))

# ═══════════════════════════════════════════════════════════
# ÍRIS TRACKING NATIVO (MediaPipe FaceMesh refine_landmarks)
# Índices 468–472 (íris esquerda) e 473–477 (íris direita).
# ═══════════════════════════════════════════════════════════
def compute_iris_radius(lms):
    """Raio geométrico médio da íris no espaço facial normalizado.

    Calcula a distância do centro de cada íris (468 / 473) às suas quatro
    bordas cardeais, retornando o raio médio normalizado pela largura facial.
    """
    try:
        fw = np.hypot(lms[LEFT_EYE_OUTER][0] - lms[RIGHT_EYE_OUTER][0],
                      lms[LEFT_EYE_OUTER][1] - lms[RIGHT_EYE_OUTER][1])
        if fw < 0.001:
            fw = 0.001

        def _radius(center_idx, border_idxs):
            cx, cy = lms[center_idx]
            dists = [np.hypot(lms[b][0] - cx, lms[b][1] - cy) for b in border_idxs]
            return sum(dists) / len(dists)

        r_left = _radius(468, [469, 470, 471, 472])
        r_right = _radius(473, [474, 475, 476, 477])
        return float((r_left + r_right) / (2.0 * fw))
    except Exception:
        return 0.0


# ═══════════════════════════════════════════════════════════
# MULTIMODALIDADE LOCAL — Whisper no próprio processo (STT + análise vocal)
#
# Substitui o servidor Speaches, que era o mesmo modelo (`Systran/faster-whisper-small`
# é uma conversão CTranslate2 do `openai/whisper-small`) atrás de HTTP na porta 8000.
# Correr no processo tira a dependência de um servidor externo, de Docker e de rede:
# o pacote deixa de precisar de instalação nenhuma para o ditado funcionar.
# Carregamento preguiçoso — quem nunca usa a voz não paga o modelo na memória.
# ═══════════════════════════════════════════════════════════
WHISPER_MODEL = os.environ.get("SENSUS_WHISPER_MODEL", "openai/whisper-small")
SAMPLE_RATE_STT = 16000    # taxa a que o Whisper foi treinado

_POS_WORDS = ("bem", "feliz", "calmo", "tranquilo", "bom", "gosto", "obrigado", "amor", "paz", "relaxad")
_NEG_WORDS = ("mal", "triste", "cansad", "stress", "ansios", "nervos", "medo", "dor", "raiva", "irritad", "pânico", "panico")
_HIGH_AROUSAL = ("stress", "ansios", "nervos", "pânico", "panico", "raiva", "irritad", "agitad", "medo")

_whisper = {"pipe": None, "falhou": False}

def _obter_whisper():
    """Pipeline de transcrição, carregado à primeira utilização. None se falhar."""
    if _whisper["pipe"] is not None or _whisper["falhou"]:
        return _whisper["pipe"]
    try:
        # O cadeado cobre também a construção do modelo, e não só o import — ver
        # `_HF_LOCK`. Sem isso o Whisper saía por vezes em `meta` device.
        with _HF_LOCK:
            from transformers import pipeline as hf_pipeline
            import torch as _torch
            usa_gpu = _torch.cuda.is_available()
            _whisper["pipe"] = hf_pipeline(
                "automatic-speech-recognition",
                model=WHISPER_MODEL,
                device=0 if usa_gpu else -1,
                torch_dtype=_torch.float16 if usa_gpu else _torch.float32,
            )
        print(f"[VOZ] Whisper local pronto ({WHISPER_MODEL}, "
              f"{'GPU' if usa_gpu else 'CPU'}).", file=sys.stderr)
    except Exception as ex:
        _whisper["falhou"] = True
        print(f"[VOZ] Whisper indisponível ({ex}) — transcrição desligada.", file=sys.stderr)
    return _whisper["pipe"]

def transcrever_pcm(pcm):
    """Transcreve PCM mono float32 a 16 kHz. '' se não der ou for curto demais."""
    # Menos de 0,2 s não é fala; poupa uma passagem inteira pelo modelo.
    if pcm is None or len(pcm) < SAMPLE_RATE_STT // 5:
        return ""
    pipe = _obter_whisper()
    if pipe is None:
        return ""
    try:
        resultado = pipe(
            {"raw": pcm, "sampling_rate": SAMPLE_RATE_STT},
            generate_kwargs={"language": "portuguese", "task": "transcribe"},
        )
        return (resultado.get("text") or "").strip()
    except Exception as ex:
        print(f"[VOZ] Falha na transcrição ({ex}).", file=sys.stderr)
        return ""

# O ditado do painel do Assistente não passa por aqui: corre no `stt_local.py`,
# um processo persistente que o Electron mantém vivo. Aqui só entra o microfone
# da análise vocal contínua, que já vive dentro deste processo.

def classify_vocal_state(text):
    """Classifica texto transcrito nos eixos dimensionais de Russell.

    Retorna a etiqueta dominante: 'positivo', 'negativo', 'ativado' ou 'nao ativado'.
    """
    if not text:
        return None
    low = text.lower()
    neg = sum(1 for w in _NEG_WORDS if w in low)
    pos = sum(1 for w in _POS_WORDS if w in low)
    high = sum(1 for w in _HIGH_AROUSAL if w in low)
    if high >= 1:
        return "ativado"
    if neg > pos:
        return "negativo"
    if pos > neg:
        return "positivo"
    return "nao ativado"

def apply_compensatory_feedback(label):
    """Loop de feedback compensatório: ajusta a geração de forma INVERSA
    para induzir homeostase emocional (secção 3)."""
    if label == "negativo":
        # Escala mais brilhante (Lídio) e fundo mais quente/acolhedor.
        compensatory["force_scale"] = "lydian"
        compensatory["cutoff_mult"] = 1.15
        compensatory["mute_perc"] = False
        compensatory["bpm_mult"] = 1.0
        return "warm"
    if label == "ativado":
        # Reduz drasticamente o BPM, silencia percussão e fecha o filtro.
        compensatory["force_scale"] = None
        compensatory["bpm_mult"] = 0.55
        compensatory["cutoff_mult"] = 0.5
        compensatory["mute_perc"] = True
        return "calm"
    # Estado neutro/positivo — restaura a geração natural.
    compensatory["force_scale"] = None
    compensatory["bpm_mult"] = 1.0
    compensatory["cutoff_mult"] = 1.0
    compensatory["mute_perc"] = False
    return "neutral"


class VoiceAnalysisThread(threading.Thread):
    """Grava voz ambiente em blocos de 5 s, transcreve localmente e aplica o
    loop de feedback compensatório. Emite dicas de canvas via callback."""

    def __init__(self, on_result=None):
        super().__init__(daemon=True)
        self.running = True
        self.enabled = True
        self.on_result = on_result
        self.canvas_hint = "neutral"

    def run(self):
        try:
            import sounddevice as sd
        except Exception as e:
            print(f"[VOZ] Análise vocal indisponível: {e}", file=sys.stderr)
            return
        sr = SAMPLE_RATE_STT
        while self.running:
            if not self.enabled:
                time.sleep(0.5)
                continue
            try:
                rec = sd.rec(int(5 * sr), samplerate=sr, channels=1, dtype="int16")
                sd.wait()
                # Direto do microfone para o modelo. Com o Speaches era preciso
                # escrever um .wav para o enviar por HTTP — e era esse ficheiro
                # que ficava para trás quando o servidor não respondia.
                pcm = rec.reshape(-1).astype(np.float32) / 32768.0
                text = transcrever_pcm(pcm)
                label = classify_vocal_state(text)
                if label:
                    self.canvas_hint = apply_compensatory_feedback(label)
                    print(f"[VOZ] Estado vocal: {label} → homeostase '{self.canvas_hint}'.", file=sys.stderr)
                    if self.on_result:
                        self.on_result(label, self.canvas_hint)
            except Exception as e:
                print(f"[VOZ] Falha na análise vocal: {e}", file=sys.stderr)
                time.sleep(2.0)


def calcular_bpm(bvp_signal, fps):
    low_hz  = 50.0 / 60.0
    high_hz = 140.0 / 60.0
    if len(bvp_signal) < 4:
        return None
    freqs, psd = welch(bvp_signal, fs=fps, nperseg=min(len(bvp_signal), 256))
    valid_idx = np.where((freqs >= low_hz) & (freqs <= high_hz))[0]
    if len(valid_idx) == 0:
        return None
    return int(freqs[valid_idx][np.argmax(psd[valid_idx])] * 60.0)

def map_denoising_to_t_index(denoising, steps):
    start_t = int(50 * (1.0 - denoising))
    start_t = max(1, min(48, start_t))
    t_list = []
    step_gap = max(1, (50 - start_t) // steps)
    for i in range(steps):
        t = start_t + i * step_gap
        if t < 50:
            t_list.append(t)
    return t_list

# ═══════════════════════════════════════════════════════════
# MARCADORES NO ROSTO — feed "Parâmetros"
# ═══════════════════════════════════════════════════════════
# Os nomes das Action Units (FACS, Ekman & Friesen, 1978) viviam aqui para o
# painel desenhado no vídeo. Esse painel passou para a interface, por isso as
# etiquetas passaram com ele — ver AU_LABELS em BiometricPanel.tsx. O motor
# continua a medir e a enviar os valores em frame_data["au"].
_IRIS_L_CENTER, _IRIS_R_CENTER = 468, 473

def draw_face_markers(frame, fd, lms_px, sensors):
    """Marcadores posicionais no rosto: vetor do olhar e centros das íris.

    Só isto fica gravado no vídeo. O painel de valores (Action Units, pose,
    ocular, vitais) passou para a interface, desenhado em DOM a partir da mesma
    telemetria — ver `BiometricPanel.tsx`.

    Porquê: o painel exigia ampliar o frame 2× antes de desenhar, para as fontes
    Hershey saírem nítidas. Medido, isso custava ~8 ms de desenho e obrigava a
    codificar 1280×960 em vez de 640×480 (16 ms contra 5 ms, e ~3× os bytes por
    frame). Em DOM o texto é vetorial, fica nítido a qualquer tamanho, e não paga
    nada disto. Estes marcadores ficam porque são posições sobre a imagem, não
    valores — o seu sítio é mesmo o vídeo.
    """
    try:
        if not sensors.get("iris", True):
            return frame
        if not lms_px or len(lms_px) <= _IRIS_R_CENTER:
            return frame
        ciano = (255, 229, 0)
        gaze = fd.get("gaze", [0.0, 0.0])
        nose = lms_px[NOSE_TIP]
        end = (int(nose[0] + gaze[0] * 70), int(nose[1] - gaze[1] * 70))
        cv2.arrowedLine(frame, nose, end, ciano, 1, cv2.LINE_AA, tipLength=0.25)
        for idx in (_IRIS_L_CENTER, _IRIS_R_CENTER):
            cv2.circle(frame, lms_px[idx], 5, ciano, 1, cv2.LINE_AA)
        return frame
    except Exception as ex:
        print(f"[OVERLAY ERRO] {ex}", file=sys.stderr)
        return frame


# ═══════════════════════════════════════════════════════════
# DEPTH MAP — Depth Anything V2 (Yang et al., 2024, arXiv:2406.09414)
# ═══════════════════════════════════════════════════════════
class DepthEstimator:
    """Profundidade monocular em tempo real para o feed de parâmetros.

    Backends por ordem de preferência:
    1. TensorRT — requer `tensorrt` + `pycuda` e um ficheiro .engine
       (env SENSUS_DEPTH_ENGINE ou `depth_anything_v2.engine` junto ao script).
    2. transformers — `depth-anything/Depth-Anything-V2-Small-hf` em CUDA
       (download do modelo na primeira utilização; requer internet uma vez).

    Carregamento lazy em thread própria (nunca bloqueia o loop principal).
    Estados: idle | loading | ready | erro.
    """

    def __init__(self):
        self.status = "idle"
        self.backend = None
        self._lock = threading.Lock()
        self._trt = None          # (context, inputs, outputs, bindings, stream, shape)
        self._pipe = None         # pipeline transformers
        self._last_map = None
        self._last_t = 0.0
        # Inferência assíncrona: slot do pedido e thread dedicada.
        self._infer_lock = threading.Lock()
        self._pedido = None
        self._infer_thread = None

    def ensure_loading(self):
        with self._lock:
            if self.status in ("loading", "ready"):
                return
            self.status = "loading"
        threading.Thread(target=self._load, daemon=True).start()

    def _load(self):
        try:
            if self._try_load_trt():
                self.backend = "tensorrt"
            else:
                # Import e construção do modelo dentro do cadeado — ver `_HF_LOCK`.
                # Pode esperar pelo arranque do StreamDiffusion, e é isso que se
                # quer: em paralelo, um dos dois nascia em `meta` device.
                with _HF_LOCK:
                    from transformers import pipeline as hf_pipeline
                    import torch as _torch
                    device = 0 if _torch.cuda.is_available() else -1
                    self._pipe = hf_pipeline(
                        "depth-estimation",
                        model="depth-anything/Depth-Anything-V2-Small-hf",
                        device=device,
                        use_fast=True,
                    )
                self.backend = "transformers"
            self.status = "ready"
            print(f"[DEPTH] Backend pronto: {self.backend}", file=sys.stderr)
        except Exception as ex:
            self.status = "erro"
            print(f"[DEPTH ERRO] Falha ao carregar: {ex}", file=sys.stderr)

    def _try_load_trt(self):
        engine_path = os.environ.get("SENSUS_DEPTH_ENGINE") or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "depth_anything_v2.engine")
        if not os.path.exists(engine_path):
            return False
        try:
            import tensorrt as trt
            import pycuda.driver as cuda
            import pycuda.autoinit  # noqa: F401
        except ImportError:
            print("[DEPTH] .engine encontrado mas tensorrt/pycuda em falta — fallback transformers.", file=sys.stderr)
            return False
        logger = trt.Logger(trt.Logger.WARNING)
        with open(engine_path, "rb") as fh, trt.Runtime(logger) as runtime:
            engine = runtime.deserialize_cuda_engine(fh.read())
        context = engine.create_execution_context()
        inputs, outputs, bindings = [], [], []
        stream = cuda.Stream()
        for i in range(engine.num_bindings):
            shape = engine.get_binding_shape(i)
            size = trt.volume(shape)
            dtype = trt.nptype(engine.get_binding_dtype(i))
            host_mem = cuda.pagelocked_empty(size, dtype)
            device_mem = cuda.mem_alloc(host_mem.nbytes)
            bindings.append(int(device_mem))
            if engine.binding_is_input(i):
                inputs.append({"host": host_mem, "device": device_mem, "shape": shape})
            else:
                outputs.append({"host": host_mem, "device": device_mem, "shape": shape})
        self._trt = {"engine": engine, "context": context, "inputs": inputs,
                     "outputs": outputs, "bindings": bindings, "stream": stream,
                     "cuda": cuda}
        return True

    def _trt_infer(self, img):
        """Inferência TensorRT → mapa de profundidade uint8 (0-255) no tamanho do frame."""
        t = self._trt
        cuda = t["cuda"]
        input_shape = t["inputs"][0]["shape"]  # NCHW, ex. (1, 3, 518, 518)
        h, w = int(input_shape[2]), int(input_shape[3])
        orig_h, orig_w = img.shape[:2]
        img_resized = cv2.resize(img, (w, h))
        img_rgb = cv2.cvtColor(img_resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        img_norm = (img_rgb - mean) / std
        img_input = np.expand_dims(np.transpose(img_norm, (2, 0, 1)), axis=0).ravel()
        np.copyto(t["inputs"][0]["host"], img_input)
        cuda.memcpy_htod_async(t["inputs"][0]["device"], t["inputs"][0]["host"], t["stream"])
        t["context"].execute_async_v2(bindings=t["bindings"], stream_handle=t["stream"].handle)
        cuda.memcpy_dtoh_async(t["outputs"][0]["host"], t["outputs"][0]["device"], t["stream"])
        t["stream"].synchronize()
        depth = np.squeeze(t["outputs"][0]["host"].reshape(t["outputs"][0]["shape"]))
        depth = cv2.resize(depth, (orig_w, orig_h))
        dmin, dmax = depth.min(), depth.max()
        if dmax > dmin:
            return (255 * (depth - dmin) / (dmax - dmin)).astype(np.uint8)
        return np.zeros_like(depth, dtype=np.uint8)

    def _pedir_inferencia(self, frame_bgr):
        """Entrega o frame mais recente à thread de inferência.

        Slot único: se chegarem frames mais depressa do que a inferência os
        consome, o certo é calcular sobre o mais recente e descartar os outros —
        uma fila só acumularia atraso entre o que se vê e o que se calculou.
        """
        with self._infer_lock:
            self._pedido = frame_bgr
            if self._infer_thread is None:
                self._infer_thread = threading.Thread(
                    target=self._infer_loop, daemon=True, name="depth")
                self._infer_thread.start()

    def _infer_loop(self):
        while True:
            with self._infer_lock:
                frame_bgr = self._pedido
                self._pedido = None
            agora = time.time()
            # Mantém-se o tecto de ~10 Hz: acima disso a inferência competiria
            # com o StreamDiffusion pela mesma GPU sem ganho visível.
            if frame_bgr is None or (agora - self._last_t) < 0.10:
                time.sleep(0.005)
                continue
            try:
                if self.backend == "tensorrt":
                    depth_u8 = self._trt_infer(frame_bgr)
                else:
                    pil = Image.fromarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
                    depth = np.array(self._pipe(pil)["depth"], dtype=np.float32)
                    dmin, dmax = depth.min(), depth.max()
                    if dmax > dmin:
                        depth_u8 = (255 * (depth - dmin) / (dmax - dmin)).astype(np.uint8)
                    else:
                        depth_u8 = np.zeros(depth.shape, dtype=np.uint8)
                    depth_u8 = cv2.resize(depth_u8, (frame_bgr.shape[1], frame_bgr.shape[0]))
                # Escala de cinzentos: claro = perto, escuro = longe
                self._last_map = cv2.cvtColor(depth_u8, cv2.COLOR_GRAY2BGR)
                self._last_t = time.time()
            except Exception as ex:
                print(f"[DEPTH ERRO] Inferência falhou: {ex}", file=sys.stderr)
                self.status = "erro"
                return

    def render(self, frame_bgr):
        """Mapa de profundidade a preto e branco (claro=perto, escuro=longe)
        sobreposto de forma translúcida à câmara, ou None se indisponível."""
        if self.status != "ready":
            return None
        now = time.time()
        # Cache curto: limita a inferência a ~10 Hz para não competir com o SD.
        # O blend com a câmara é feito em todos os frames (custo negligível),
        # para que a imagem de fundo se mantenha fluida mesmo entre inferências.
        # A inferência corre numa thread própria e o ciclo nunca espera por ela:
        # medida, custa 82,9 ms, o que sozinho punha o Air Painting a 8 FPS.
        # Aqui só se entrega o frame mais recente e se usa o último mapa pronto.
        self._pedir_inferencia(frame_bgr)
        colored = self._last_map
        if colored is None:
            return None
        if colored.shape[:2] != frame_bgr.shape[:2]:
            colored = cv2.resize(colored, (frame_bgr.shape[1], frame_bgr.shape[0]))
        return cv2.addWeighted(colored, 0.8, frame_bgr, 0.2, 0)

    def render_still(self, img_bgr):
        """Mapa de profundidade de uma imagem fixa, em escala de cinzentos.

        Nao toca em _last_map nem em _last_t: o mapa da camara ao vivo continua
        intacto. Usado para aplicar as ferramentas 3D a uma imagem de cenario.
        """
        if self.status != "ready":
            return None
        try:
            if self.backend == "tensorrt":
                depth_u8 = self._trt_infer(img_bgr)
            else:
                pil = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
                depth = np.array(self._pipe(pil)["depth"], dtype=np.float32)
                dmin, dmax = depth.min(), depth.max()
                if dmax > dmin:
                    depth_u8 = (255 * (depth - dmin) / (dmax - dmin)).astype(np.uint8)
                else:
                    depth_u8 = np.zeros(depth.shape, dtype=np.uint8)
                depth_u8 = cv2.resize(depth_u8, (img_bgr.shape[1], img_bgr.shape[0]))
            return cv2.cvtColor(depth_u8, cv2.COLOR_GRAY2BGR)
        except Exception as ex:
            print(f"[DEPTH ERRO] Profundidade da imagem de fundo falhou: {ex}", file=sys.stderr)
            return None

    def get_last_map(self):
        """Devolve o último mapa de profundidade puro (sem blend com a câmara), ou None."""
        return self._last_map

    def get_last_map_t(self):
        """Instante em que o último mapa foi calculado.

        Serve de carimbo a quem consome o mapa: a inferência corre a ~10 Hz e o
        ciclo principal a mais do dobro, por isso a maior parte dos frames vê o
        mesmo mapa que o anterior. Comparar o carimbo evita voltar a codificá-lo.
        """
        return self._last_t

# Estado partilhado do overlay (dict mutável — dispensa `global` em main())
depth_estimator = DepthEstimator()


# ═══════════════════════════════════════════════════════════
# AIR PAINTING — tela de pintura acionada por profundidade
# ═══════════════════════════════════════════════════════════
# O gatilho é o eixo Z: a ponta do indicador só pinta quando a profundidade
# amostrada nessa coordenada passa um limiar — ou seja, quando a mão se estende
# na direção da câmara. O mapa do Depth Anything V2 (Yang et al., 2024,
# arXiv:2406.09414) é relativo, não métrico, e normalizado por frame com
# claro = perto; daí o teste ser `valor >= limiar` e o limiar ser calibrável em
# vez de fixo — o mesmo gesto dá valores diferentes conforme o que mais estiver
# no enquadramento.
# Índices na malha de 21 pontos do MediaPipe Hands.
_PULSO = 0
_POLEGAR_PONTA = 4
_INDEX_FINGER_TIP = 8
_MEDIO_MCP = 9          # base do dedo médio — serve de escala da mão
# (ponta, articulação intermédia) dos quatro dedos que fecham no punho.
_DEDOS_FECHO = ((8, 6), (12, 10), (16, 14), (20, 18))

# Amplitude do afastamento polegar-indicador, em múltiplos da escala da mão
# (pulso→base do médio). Medido com a mão a ~60 cm: pinça fechada fica perto de
# 0.25 e a abertura confortável máxima ronda 1.5. Normalizar pela escala é o que
# torna a leitura independente da distância à câmara.
_PINCA_MIN, _PINCA_MAX = 0.25, 1.5

# Distância entre os dois indicadores, em múltiplos da escala da mão, abaixo da
# qual se considera que as mãos bateram uma na outra. Uma palma junta as mãos a
# menos de metade da largura de uma delas; 0.6 dá margem sem disparar quando se
# está simplesmente a desenhar com as duas ao mesmo tempo.
_PALMA_DISTANCIA = 0.6

# Afastamento médio entre os 21 pontos de duas deteções, na mesma unidade,
# abaixo do qual elas se sobrepõem na imagem. Uma mão a sair do enquadramento
# chega a ser devolvida duas vezes pelo MediaPipe — o seguidor mantém a região
# antiga e a deteção nova cai por cima — e as duas cópias ficam praticamente no
# mesmo sítio. Ver `_desduplicar`, que é onde isto é usado e onde está a
# explicação do estrago que as cópias faziam.
_SOBREPOSICAO_MESMA_MAO = 0.35

# Número de camadas de pintura. Fixo: são buffers do tamanho do frame (~900 KB
# cada), e mais do que isto seria memória parada sem ganho para a peça.
_NUM_CAMADAS = 3

# Tipos de traço disponíveis.
_CANETAS = ("solida", "caligrafica", "spray", "neon")


class AirPainter:
    """Tela persistente pintada pela ponta do indicador.

    Mantém dois buffers do tamanho do frame: `canvas` (a tinta) e `mascara`
    (onde há tinta). Ambos são escritos só onde se desenha; a composição por
    frame usa operações do OpenCV, vetorizadas, em vez de indexação numpy.

    A máscara é desenhada sem anti-aliasing de propósito: a composição opaca
    (`frame & ~mascara + canvas`) é bitwise, e valores intermédios de máscara
    produziriam franjas escuras em vez de bordos suaves.
    """

    def __init__(self):
        self.status = "idle"            # idle | loading | ready | erro
        self._hands = None
        self.forma = None               # (h, w) dos buffers atuais
        # Ajustáveis em tempo real pelo painel de controlo
        self.limiar = 140               # 0-255 no mapa de profundidade
        self.cor = (255, 103, 124)      # BGR — roxo da marca
        self.espessura = 6              # usada quando a espessura por gesto está desligada
        self.suavizacao = 0.45          # 0 = sem filtro, ~1 = muito lento a seguir
        self.borracha = False           # borracha manual (o painel), além da mão esquerda
        self.espessura_por_gesto = True # afastamento polegar-indicador → espessura
        self.espessura_min = 2
        self.espessura_max = 34
        self.cor_secundaria = (255, 214, 102)   # BGR — amarelo da paleta
        self.cor_ativa = "principal"            # principal | secundaria
        self.espelhar = True            # a webcam devolve a imagem não espelhada
        self.trocar_maos = False        # inverte a atribuição esquerda/direita
        # Exigir também profundidade acima do limiar para pintar. Desligado por
        # omissão desde que o gesto passou a ser o gatilho: obrigar às duas
        # condições fazia a mão aberta não pintar sem se perceber porquê.
        self.exigir_profundidade = False
        # ── Camadas ──
        # Cada camada tem a sua tinta, máscara, opacidade e modo de mistura. A
        # composição percorre-as por ordem, da 0 para cima.
        self.camadas = []
        self.camada_ativa = 0
        self.caneta = "solida"
        # Bater palmas limpa tudo; guarda-se o instante para não disparar em
        # rajada enquanto as mãos estiverem juntas.
        self._ultima_palma = 0.0
        # Deteção de mãos em thread própria: 32 ms medidos por frame, e o custo
        # é fixo (não baixa com a resolução). O ciclo entrega o frame mais
        # recente e usa o último resultado pronto, em vez de esperar por ele.
        self._maos_lock = threading.Lock()
        self._maos_pedido = None
        self._maos_resultado = None
        self._maos_thread = None
        # Estado por papel: as duas mãos podem desenhar ao mesmo tempo, uma a
        # pintar e a outra a apagar, e cada traço tem o seu ponto anterior.
        self.anteriores = {"pintar": None, "apagar": None}
        self.suaves = {"pintar": None, "apagar": None}
        # Instantâneos para anular. Guardam-se por traço, não por frame: um frame
        # a 640×480 são ~900 KB e uma pilha por frame comia memória à vista.
        self._historico = []
        self._MAX_HISTORICO = 12
        self._traco_ativo = False       # há traço em curso ainda por arquivar
        self.info = {"mao": False, "x": 0.0, "y": 0.0, "z": 0, "pintar": False,
                     "fechada": False, "pinca": 0.0, "espessura": 6,
                     "dedos": 0, "papel": "", "gesto": "sem_mao", "maos": 0}

    def _garantir_modelo(self):
        if self._hands is not None or self.status == "erro":
            return
        try:
            self.status = "loading"
            from mediapipe.python.solutions import hands as mp_hands
            self._hands = mp_hands.Hands(
                static_image_mode=False,     # modo de vídeo: deteta uma vez, depois segue
                max_num_hands=2,          # direita pinta, esquerda apaga
                model_complexity=0,          # o modelo leve chega para uma ponta de dedo
                min_detection_confidence=0.6,
                min_tracking_confidence=0.5,
            )
            self.status = "ready"
        except Exception as ex:
            self.status = "erro"
            print(f"[AIRPAINT ERRO] MediaPipe Hands não carregou: {ex}", file=sys.stderr)

    def _garantir_buffers(self, forma):
        if self.forma != forma:
            self.camadas = [{
                "canvas": np.zeros((forma[0], forma[1], 3), dtype=np.uint8),
                "mascara": np.zeros((forma[0], forma[1], 3), dtype=np.uint8),
                "opacidade": 1.0,
                "mistura": "normal",   # normal | adicionar | multiplicar | ecra
                "visivel": True,
                # Bandeira em vez de mascara.any(): o teste custava 0,84 ms por
                # camada e por frame, mais do que a composição que evitava.
                "vazia": True,
            } for _ in range(_NUM_CAMADAS)]
            self.camada_ativa = 0
            self.forma = forma
            self._terminar_traco()
            self.suaves = {"pintar": None, "apagar": None}

    @property
    def canvas(self):
        """Tinta da camada ativa. Mantido como propriedade para o resto do
        código (anular, limpar, testes) continuar a falar de `canvas`."""
        return self.camadas[self.camada_ativa]["canvas"] if self.camadas else None

    @property
    def mascara(self):
        return self.camadas[self.camada_ativa]["mascara"] if self.camadas else None

    def limpar(self):
        """Esvazia todas as camadas. É o que a palma e o botão fazem."""
        if self.camadas:
            self._arquivar()
            for c in self.camadas:
                c["canvas"][:] = 0
                c["mascara"][:] = 0
                c["vazia"] = True
        self._terminar_traco()
        self.suaves = {"pintar": None, "apagar": None}

    # ── Anular ──
    def _arquivar(self):
        """Guarda o estado atual, para o traço seguinte poder ser anulado."""
        if not self.camadas:
            return
        # Instantâneo de todas as camadas: anular tem de repor o que estava,
        # e uma palma ou uma troca de camada mexe em mais do que a ativa.
        self._historico.append([(c["canvas"].copy(), c["mascara"].copy(), c["vazia"]) for c in self.camadas])
        if len(self._historico) > self._MAX_HISTORICO:
            self._historico.pop(0)

    def anular(self):
        if not self._historico:
            return False
        instantaneo = self._historico.pop()
        for camada, (canvas, mascara, vazia) in zip(self.camadas, instantaneo):
            camada["canvas"][:] = canvas
            camada["mascara"][:] = mascara
            camada["vazia"] = vazia
        self._terminar_traco()
        return True

    # ── Leitura de gestos ──
    @staticmethod
    def _dist(a, b):
        return math.hypot(a.x - b.x, a.y - b.y)

    def _escala_mao(self, lm):
        """Distância pulso→base do médio. Serve de unidade: cresce e encolhe com
        a mão na imagem, por isso as medidas normalizadas por ela não dependem
        da distância à câmara."""
        return max(1e-4, self._dist(lm[_PULSO], lm[_MEDIO_MCP]))

    def _mao_fechada(self, lm):
        """Punho fechado: pelo menos três dos quatro dedos dobrados.

        Dobrado = a ponta está mais perto do pulso do que a articulação
        intermédia. Comparar distâncias ao pulso, e não as coordenadas y, mantém
        a leitura correta com a mão inclinada ou de lado.
        """
        pulso = lm[_PULSO]
        dobrados = sum(
            1 for ponta, meio in _DEDOS_FECHO
            if self._dist(lm[ponta], pulso) < self._dist(lm[meio], pulso)
        )
        return dobrados >= 3

    def _dedos_estendidos(self, lm):
        """Quantos dos quatro dedos (sem o polegar) estão esticados, 0 a 4.

        Mesmo critério do punho fechado: a ponta esticada fica mais longe do
        pulso do que a articulação intermédia. Comparar distâncias, e não
        coordenadas y, mantém a contagem certa com a mão inclinada ou de lado.
        """
        pulso = lm[_PULSO]
        return sum(
            1 for ponta, meio in _DEDOS_FECHO
            if self._dist(lm[ponta], pulso) > self._dist(lm[meio], pulso)
        )

    def _papel(self, etiqueta):
        """Traduz a lateralidade do MediaPipe no papel da mão.

        O MediaPipe atribui as etiquetas assumindo que a imagem está espelhada
        (vista de selfie). O feed da webcam não está, por isso a mão direita de
        quem está à frente aparece do lado esquerdo e vem rotulada "Left". Daí a
        troca. `trocar_maos` existe porque nem todas as câmaras entregam a imagem
        na mesma orientação, e isso resolve-se com um clique em vez de código.
        """
        direita = (etiqueta == "Left")
        if self.trocar_maos:
            direita = not direita
        return "pintar" if direita else "apagar"

    @staticmethod
    def _etiqueta(lateralidades, indice):
        """Lateralidade que o MediaPipe deu à mão `indice`, ou "Right" se faltar."""
        if indice < len(lateralidades):
            try:
                return lateralidades[indice].classification[0].label
            except Exception:
                pass
        return "Right"

    def _desduplicar(self, maos, lateralidades):
        """Deixa cair a mesma mão quando ela vem detetada duas vezes.

        Devolve `[(marcos, etiqueta), ...]`. É a primeira coisa que `processar`
        faz, porque as cópias custavam os dois defeitos que se viam no Air
        Painting:

        - Uma cópia ficava com o papel de pintar e a outra com o de apagar, quase
          no mesmo pixel: a borracha seguia o traço e apagava-o à medida que ele
          era desenhado.
        - E as duas cópias têm os indicadores à distância zero, o que passava o
          teste da palma sem ninguém ter batido palmas. A tela era limpa sozinha
          — era isto que acontecia quando uma mão saía do ecrã.

        O que distingue duas cópias de duas mãos é a **lateralidade**: a mesma
        imagem classificada duas vezes dá a mesma etiqueta; duas mãos dão
        etiquetas opostas. A proximidade sozinha não chegava, porque numa palma
        vista de frente as duas mãos também se sobrepõem na imagem. São precisas
        as duas condições juntas — mesma etiqueta **e** sobreposição — e por isso
        uma palma a sério continua a passar.
        """
        lista = [(m, self._etiqueta(lateralidades, i)) for i, m in enumerate(maos)]
        if len(lista) != 2 or lista[0][1] != lista[1][1]:
            return lista
        a, b = lista[0][0].landmark, lista[1][0].landmark
        escala = 0.5 * (self._escala_mao(a) + self._escala_mao(b))
        if escala <= 1e-4:
            return lista
        afastamento = sum(self._dist(pa, pb) for pa, pb in zip(a, b)) / (len(a) * escala)
        return lista[:1] if afastamento < _SOBREPOSICAO_MESMA_MAO else lista

    def _papeis(self, maos, etiquetas):
        """Um papel por mão, com a garantia de que duas mãos nunca partilham o
        mesmo.

        O estado de cada traço — ponto anterior e posição suavizada — é guardado
        **por papel**. Enquanto o papel saía apenas da etiqueta do MediaPipe,
        duas mãos podiam receber o mesmo: o classificador de lateralidade erra, e
        erra precisamente quando as mãos se cruzam, se sobrepõem ou chegam ao
        bordo do enquadramento. As duas escreviam então no mesmo ponto anterior e
        o traço saltava de uma mão para a outra a cada frame — uma linha reta a
        unir as duas. Era esse o conflito com as duas mãos no ecrã.

        Com duas mãos, o papel decide-se pela **posição horizontal**, que é
        inequívoca e não depende de classificador nenhum: o feed não vem
        espelhado, por isso a mão direita de quem está à frente aparece do lado
        esquerdo da imagem — o mesmo raciocínio que já governava a leitura da
        etiqueta (ver `_papel`). Com uma mão só não há colisão possível e vale a
        etiqueta, que distingue as mãos mesmo quando estão do mesmo lado.
        """
        if len(maos) != 2:
            return [self._papel(e) for e in etiquetas]
        mais_a_esquerda = 0 if maos[0].landmark[_PULSO].x <= maos[1].landmark[_PULSO].x else 1
        papeis = ["", ""]
        papeis[mais_a_esquerda] = "apagar" if self.trocar_maos else "pintar"
        papeis[1 - mais_a_esquerda] = "pintar" if self.trocar_maos else "apagar"
        return papeis

    def _e_palma(self, maos):
        """Bateram palmas? Corre sobre a lista já desduplicada, e exige duas
        coisas em vez de uma.

        1. As duas mãos **abertas**. Bate-se uma palma com as mãos abertas, e
           exigi-lo impede que juntar dois dedos a desenhar apague tudo.
        2. Indicadores **juntos** — o teste que já cá estava.

        A terceira condição, a que faltava — serem mesmo duas mãos e não a mesma
        duas vezes — está resolvida a montante, em `_desduplicar`.
        """
        if len(maos) != 2:
            return False
        a, b = maos[0].landmark, maos[1].landmark
        escala = 0.5 * (self._escala_mao(a) + self._escala_mao(b))
        if escala <= 1e-4:
            return False
        if self._dedos_estendidos(a) < 3 or self._dedos_estendidos(b) < 3:
            return False
        return self._dist(a[_INDEX_FINGER_TIP], b[_INDEX_FINGER_TIP]) / escala < _PALMA_DISTANCIA

    def _pinca(self, lm):
        """Afastamento polegar-indicador, 0 (juntos) a 1 (aberto)."""
        d = self._dist(lm[_POLEGAR_PONTA], lm[_INDEX_FINGER_TIP]) / self._escala_mao(lm)
        return min(1.0, max(0.0, (d - _PINCA_MIN) / (_PINCA_MAX - _PINCA_MIN)))

    def _espessura_atual(self, pinca):
        if not self.espessura_por_gesto:
            return int(self.espessura)
        return int(round(self.espessura_min + pinca * (self.espessura_max - self.espessura_min)))

    def _terminar_traco(self, papel=None):
        """Fecha o traço em curso. O ponto anterior é esquecido, para o traço
        seguinte não se unir a este por uma linha reta através do ecrã.

        Sem `papel`, fecha os das duas mãos.
        """
        if papel is None:
            self.anteriores = {"pintar": None, "apagar": None}
        else:
            self.anteriores[papel] = None
        if all(v is None for v in self.anteriores.values()):
            self._traco_ativo = False

    def _maos_recentes(self, rgb):
        """Entrega o frame à thread de deteção e devolve o último resultado.

        Slot único: frames a mais são descartados, porque desenhar sobre uma
        posição de mão desatualizada é pior do que saltar um frame.
        """
        with self._maos_lock:
            self._maos_pedido = rgb
            if self._maos_thread is None:
                self._maos_thread = threading.Thread(
                    target=self._maos_loop, daemon=True, name="hands")
                self._maos_thread.start()
            return self._maos_resultado

    def _maos_loop(self):
        while True:
            with self._maos_lock:
                rgb = self._maos_pedido
                self._maos_pedido = None
            if rgb is None:
                time.sleep(0.003)
                continue
            try:
                res = self._hands.process(rgb)
                with self._maos_lock:
                    self._maos_resultado = res
            except Exception as ex:
                print(f"[AIRPAINT ERRO] deteção de mãos: {ex}", file=sys.stderr)
                time.sleep(0.05)

    def processar(self, frame_bgr, rgb, mapa_profundidade):
        """Devolve o frame com a tela composta por cima.

        Gramática de gestos, por mão:
          0 dedos (punho)  → levanta a caneta
          1 dedo           → escolhe a cor principal
          2 dedos          → escolhe a cor secundária
          3+ dedos (aberta)→ pinta (mão direita) ou apaga (mão esquerda)

        As duas mãos podem agir ao mesmo tempo, cada uma com o seu traço.
        Nunca deixa subir exceções: este ciclo também alberga o áudio, que não
        pode parar.
        """
        try:
            self._garantir_modelo()
            if self.status != "ready":
                return frame_bgr
            h, w = frame_bgr.shape[:2]
            self._garantir_buffers((h, w))

            res = self._maos_recentes(rgb)
            maos = (res.multi_hand_landmarks if res else None) or []
            lateralidades = (res.multi_handedness if res else None) or []
            # Antes de tudo o resto: a mesma mão devolvida duas vezes não são
            # duas mãos. Ver `_desduplicar`.
            detecoes = self._desduplicar(maos, lateralidades)
            maos = [m for m, _ in detecoes]
            etiquetas = [e for _, e in detecoes]

            palma_agora = False
            # Bater palmas limpa tudo. Além das condições do gesto (ver
            # `_e_palma`), um intervalo entre disparos: senão manter as mãos
            # juntas apagaria a tela dezenas de vezes por segundo.
            agora = time.time()
            if self._e_palma(maos) and agora - self._ultima_palma > 1.2:
                self._ultima_palma = agora
                self.limpar()
                self.info["gesto"] = "palma"
                palma_agora = True

            ativos = set()
            ponteiros = []          # (x_px, y_px, papel, gesto, espessura)
            principal = None        # mão a reportar na telemetria
            papeis = self._papeis(maos, etiquetas)

            for indice, marcos in enumerate(maos):
                lm = marcos.landmark
                papel = papeis[indice]
                dedos = self._dedos_estendidos(lm)
                pinca = self._pinca(lm)
                espessura = self._espessura_atual(pinca)

                # Escolha de cor: acontece na transição, não a cada frame, para
                # manter um dedo levantado não bombardear o estado.
                if dedos == 1:
                    gesto = "cor_principal"
                    self.cor_ativa = "principal"
                elif dedos == 2:
                    gesto = "cor_secundaria"
                    self.cor_ativa = "secundaria"
                elif dedos == 0:
                    gesto = "parado"
                else:
                    gesto = "pintar" if papel == "pintar" else "apagar"

                p = lm[_INDEX_FINGER_TIP]
                x = int(min(max(p.x, 0.0), 1.0) * (w - 1))
                y = int(min(max(p.y, 0.0), 1.0) * (h - 1))

                # Média móvel exponencial por mão. Sem filtro o traço treme: a
                # deteção oscila alguns píxeis mesmo com a mão imóvel.
                anterior_suave = self.suaves.get(papel)
                if anterior_suave is None:
                    suave = (float(x), float(y))
                else:
                    a = 1.0 - min(max(self.suavizacao, 0.0), 0.95)
                    suave = (anterior_suave[0] + a * (x - anterior_suave[0]),
                             anterior_suave[1] + a * (y - anterior_suave[1]))
                self.suaves[papel] = suave
                sx, sy = int(suave[0]), int(suave[1])

                z = 0
                if mapa_profundidade is not None and mapa_profundidade.shape[:2] == (h, w):
                    z = int(mapa_profundidade[sy, sx, 0])

                # No frame da palma não se desenha: as duas mãos estão abertas,
                # e sem isto o gesto que limpa deixava logo tinta nova por cima.
                desenhar = gesto in ("pintar", "apagar") and not palma_agora
                if desenhar and self.exigir_profundidade and z < self.limiar:
                    desenhar = False
                    gesto = "longe"

                if desenhar:
                    ativos.add(papel)
                    # A borracha do painel força o modo apagar mesmo na direita.
                    apagar = (papel == "apagar") or self.borracha
                    self._desenhar_segmento(papel, sx, sy, espessura, apagar)
                else:
                    self._terminar_traco(papel)

                ponteiros.append((sx, sy, papel, gesto, espessura))
                if principal is None or gesto in ("pintar", "apagar"):
                    principal = {"x": round(sx / float(w), 4), "y": round(sy / float(h), 4),
                                 "z": z, "pintar": desenhar, "fechada": dedos == 0,
                                 "pinca": round(pinca, 3), "espessura": espessura,
                                 "dedos": dedos, "papel": papel, "gesto": gesto}

            # Mãos que saíram do enquadramento não deixam traços pendurados.
            for papel in ("pintar", "apagar"):
                if papel not in ativos and self.anteriores.get(papel) is not None:
                    self._terminar_traco(papel)

            if principal is None:
                self.info.update({"mao": False, "pintar": False, "fechada": False,
                                  "gesto": "sem_mao", "papel": "", "dedos": 0, "maos": 0})
            else:
                self.info.update(principal)
                self.info["mao"] = True
                self.info["maos"] = len(maos)

            # Composição opaca: apaga o vídeo onde há tinta e soma a tinta.
            saida = self._compor(frame_bgr)

            # Ponteiro por mão. O raio segue a espessura, para o afastamento
            # polegar-indicador se ver antes de deixar marca.
            for sx, sy, papel, gesto, espessura in ponteiros:
                raio = max(5, espessura + 4)
                if gesto == "parado":
                    cv2.line(saida, (sx - 7, sy - 7), (sx + 7, sy + 7), (140, 140, 210), 1, cv2.LINE_AA)
                    cv2.line(saida, (sx - 7, sy + 7), (sx + 7, sy - 7), (140, 140, 210), 1, cv2.LINE_AA)
                elif gesto == "cor_principal":
                    cv2.circle(saida, (sx, sy), 9, self.cor, -1, cv2.LINE_AA)
                    cv2.circle(saida, (sx, sy), 12, (255, 255, 255), 1, cv2.LINE_AA)
                elif gesto == "cor_secundaria":
                    cv2.circle(saida, (sx, sy), 9, self.cor_secundaria, -1, cv2.LINE_AA)
                    cv2.circle(saida, (sx, sy), 12, (255, 255, 255), 1, cv2.LINE_AA)
                elif gesto == "apagar":
                    cv2.circle(saida, (sx, sy), raio, (140, 140, 255), 2, cv2.LINE_AA)
                elif gesto == "pintar":
                    cv2.circle(saida, (sx, sy), raio, (255, 255, 255), 2, cv2.LINE_AA)
                else:
                    cv2.circle(saida, (sx, sy), raio, (170, 170, 170), 1, cv2.LINE_AA)

            # Espelho no fim, sobre a imagem já composta: a webcam entrega a cena
            # como a vê, não como um espelho, e sem isto quem pinta vê a mão a ir
            # para o lado contrário do gesto.
            if self.espelhar:
                saida = cv2.flip(saida, 1)
            return saida
        except Exception as ex:
            print(f"[AIRPAINT ERRO] {ex}", file=sys.stderr)
            return frame_bgr

    def _compor(self, frame_bgr):
        """Empilha as camadas sobre o vídeo, da 0 para cima.

        `normal` é opaco onde há tinta, o que exige a máscara; os restantes modos
        são operações sobre a cor e dispensam-na. A opacidade entra como peso na
        mistura final de cada camada.
        """
        saida = frame_bgr
        for camada in self.camadas:
            if not camada["visivel"]:
                continue
            tinta, mascara = camada["canvas"], camada["mascara"]
            if camada["vazia"]:
                continue
            modo = camada["mistura"]
            if modo == "adicionar":
                combinado = cv2.add(saida, tinta)
            elif modo == "ecra":
                # Screen: 1-(1-a)(1-b). Clareia sem estourar como o adicionar.
                combinado = cv2.bitwise_not(
                    cv2.multiply(cv2.bitwise_not(saida), cv2.bitwise_not(tinta), scale=1 / 255.0))
            elif modo == "multiplicar":
                combinado = cv2.multiply(saida, tinta, scale=1 / 255.0)
            else:
                combinado = cv2.add(cv2.bitwise_and(saida, cv2.bitwise_not(mascara)), tinta)
            op = max(0.0, min(1.0, camada["opacidade"]))
            saida = combinado if op >= 0.999 else cv2.addWeighted(combinado, op, saida, 1.0 - op, 0)
        return saida

    def _marcar(self, camada, ponto_a, ponto_b, cor, marca, espessura):
        """Desenha um segmento com o traço da caneta escolhida."""
        canvas, mascara = camada["canvas"], camada["mascara"]
        if self.caneta == "caligrafica":
            # Espessura variável com a direção: horizontal fino, vertical grosso.
            dx, dy = (ponto_b[0] - ponto_a[0], ponto_b[1] - ponto_a[1]) if ponto_a else (0, 1)
            peso = abs(dy) / (abs(dx) + abs(dy) + 1e-6)
            espessura = max(1, int(espessura * (0.35 + 0.65 * peso)))
        elif self.caneta == "spray":
            # Nuvem de pontos em torno do traço, em vez de uma linha contínua.
            raio = max(2, espessura)
            for _ in range(max(6, espessura * 2)):
                ox, oy = np.random.randint(-raio, raio + 1, size=2)
                if ox * ox + oy * oy > raio * raio:
                    continue
                cv2.circle(canvas, (ponto_b[0] + int(ox), ponto_b[1] + int(oy)), 1, cor, -1)
                cv2.circle(mascara, (ponto_b[0] + int(ox), ponto_b[1] + int(oy)), 1, marca, -1)
            return
        elif self.caneta == "neon":
            # Halo largo e esbatido, com um núcleo fino por cima.
            if ponto_a:
                cv2.line(canvas, ponto_a, ponto_b, tuple(int(c * 0.45) for c in cor), espessura * 3)
                cv2.line(mascara, ponto_a, ponto_b, marca, espessura * 3)
                cv2.line(canvas, ponto_a, ponto_b, (255, 255, 255), max(1, espessura // 3))
            else:
                cv2.circle(canvas, ponto_b, espessura, tuple(int(c * 0.45) for c in cor), -1)
                cv2.circle(mascara, ponto_b, espessura, marca, -1)
            return

        if ponto_a:
            cv2.line(canvas, ponto_a, ponto_b, cor, espessura)
            cv2.line(mascara, ponto_a, ponto_b, marca, espessura)
        else:
            r = max(1, espessura // 2)
            cv2.circle(canvas, ponto_b, r, cor, -1)
            cv2.circle(mascara, ponto_b, r, marca, -1)

    def _desenhar_segmento(self, papel, sx, sy, espessura, apagar):
        """Marca um segmento do traço desta mão, a pintar ou a apagar."""
        if not self._traco_ativo:
            # Instantâneo no início do traço, para o anular devolver ao estado
            # anterior a ele.
            self._arquivar()
            self._traco_ativo = True
        cor = (0, 0, 0) if apagar else (self.cor if self.cor_ativa == "principal" else self.cor_secundaria)
        marca = (0, 0, 0) if apagar else (255, 255, 255)
        anterior = self.anteriores.get(papel)
        camada = self.camadas[self.camada_ativa]
        if apagar:
            # A borracha é sempre traço sólido: uma borracha em spray ou neon
            # deixaria restos e leria como avaria.
            canvas, mascara = camada["canvas"], camada["mascara"]
            if anterior is not None:
                cv2.line(canvas, anterior, (sx, sy), cor, espessura)
                cv2.line(mascara, anterior, (sx, sy), marca, espessura)
            else:
                r = max(1, espessura // 2)
                cv2.circle(canvas, (sx, sy), r, cor, -1)
                cv2.circle(mascara, (sx, sy), r, marca, -1)
        else:
            self._marcar(camada, anterior, (sx, sy), cor, marca, espessura)
        camada["vazia"] = False
        self.anteriores[papel] = (sx, sy)


air_painter = AirPainter()
overlay_state = {"mode": "sensors"}

# ═══════════════════════════════════════════════════════════
# TELEMÓVEL — captura direta do protocolo scrcpy (sem janela visível)
# ═══════════════════════════════════════════════════════════
def conectar_telefone(serial=None):
    """Liga a um telemóvel Android via scrcpy-client (qualquer dispositivo, não só
    o do developer) e devolve um `scrcpy.Client` já a receber frames em background —
    sem abrir nenhuma janela na ecrã (ao contrário do antigo scrcpy.exe + mss)."""
    try:
        import scrcpy
        client = scrcpy.Client(device=serial, max_fps=30, bitrate=8_000_000)
        client.start(threaded=True)
        for _ in range(30):
            if client.last_frame is not None:
                break
            time.sleep(0.1)
        print(f"[Sensus AI] Telemóvel ligado ({serial or 'dispositivo único'}).", file=sys.stderr)
        return client
    except Exception as e:
        print(f"[AVISO] Não foi possível ligar ao telemóvel: {e}", file=sys.stderr)
        return None

#: Fonte de imagem que o motor está **realmente** a usar, e o último erro.
#: Vai na telemetria: sem isto a interface mostrava a câmara que o utilizador
#: escolheu enquanto o motor estava em simulação, e a única pista de que a
#: escolha tinha falhado era uma linha no stderr que ninguém lê.
camera_estado = {"fonte": "", "erro": None}


def abrir_webcam(indice):
    """Abre a webcam `indice` a 640×480 e **confirma que ela entrega imagem**.

    Devolve o `VideoCapture` ou None. Três coisas que a versão anterior não
    fazia, e cada uma delas deixou a câmara do PC inutilizável depois de passar
    pelo telemóvel:

    - **Esperar.** O DirectShow não liberta o dispositivo no instante em que se
      chama `release()`; reabrir a seguir falha e ficava tudo em simulação. Duas
      voltas com 0,4 s de intervalo resolvem o caso medido.
    - **Tentar o outro backend.** Há câmaras (e câmaras virtuais) que só abrem
      por Media Foundation. Custa uma tentativa.
    - **Ler um frame.** `isOpened()` diz que o dispositivo abriu, não que
      entrega imagem — a mesma distinção que o `preparar.ps1` aprendeu com o
      MediaPipe. Uma câmara ocupada por outra aplicação abre e nunca entrega
      nada, e o laço principal ficava em `continue` para sempre, sem telemetria
      e sem erro.
    """
    backends = ((cv2.CAP_DSHOW, "DirectShow"), (cv2.CAP_MSMF, "Media Foundation"))
    for volta in range(2):
        for backend, nome in backends:
            cap = cv2.VideoCapture(indice, backend)
            if cap.isOpened():
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                for _ in range(5):
                    ok, frame = cap.read()
                    if ok and frame is not None:
                        print(f"[Sensus AI] Webcam {indice} aberta por {nome} (640x480).",
                              file=sys.stderr)
                        return cap
                    time.sleep(0.1)
            cap.release()
        if volta == 0:
            time.sleep(0.4)
    print(f"[ERRO] A webcam {indice} nao abriu nem entregou imagem.", file=sys.stderr)
    return None


#: Quanto tempo se espera pelo primeiro frame de um telemóvel que se diz ligado
#: antes de desistir dele e voltar à câmara do PC. O `conectar_telefone` já
#: espera 3 s pelo primeiro frame antes de devolver o cliente; estes 5 s são
#: para o caso de a ligação subir e a imagem nunca vir — ecrã bloqueado ou
#: autorização de espelhamento por aceitar no telemóvel.
TELEFONE_SEM_IMAGEM_S = 5.0


def parse_camera_source(src):
    """Aceita 'pc'/'phone' (compatibilidade antiga) e 'pc:<índice>'/'phone:<serial>'."""
    if ":" in src:
        kind, _, ident = src.partition(":")
        return kind, ident
    return src, ""

# ═══════════════════════════════════════════════════════════
# STDIN LISTENER
# ═══════════════════════════════════════════════════════════
_stdin_commands = []
_stdin_lock = threading.Lock()

def _stdin_reader():
    try:
        for line in sys.stdin:
            cmd = line.strip()
            if cmd:
                with _stdin_lock:
                    _stdin_commands.append(cmd)
    except Exception:
        pass

def get_commands():
    with _stdin_lock:
        cmds = list(_stdin_commands)
        _stdin_commands.clear()
    return cmds

# ═══════════════════════════════════════════════════════════
# MAIN LOOP
# ═══════════════════════════════════════════════════════════
def _is_nvidia_broadcast_running():
    """A câmara virtual 'NVIDIA Broadcast' fica registada no DirectShow mesmo
    com a app fechada (é um driver, não desaparece) — só listamos a câmara se
    o processo da app estiver mesmo aberto, senão a imagem fica congelada."""
    try:
        out = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq NVIDIA Broadcast.exe"],
            capture_output=True, text=True, timeout=5,
        ).stdout
        return "NVIDIA Broadcast.exe" in out
    except Exception:
        return False

def list_camera_devices():
    """Enumera câmaras de PC (DirectShow, nomes reais) e telemóveis Android
    ligados por ADB. Devolve `{"cameras": [{"id": "pc:0"|"phone:<serial>", "label": ...}]}`."""
    devices = []

    try:
        from pygrabber.dshow_graph import FilterGraph
        names = FilterGraph().get_input_devices()
        broadcast_running = None
        for i, name in enumerate(names):
            if "nvidia broadcast" in name.lower():
                if broadcast_running is None:
                    broadcast_running = _is_nvidia_broadcast_running()
                if not broadcast_running:
                    continue
            devices.append({"id": f"pc:{i}", "label": name})
    except Exception:
        # Fallback: sondar índices diretamente se o pygrabber não estiver disponível.
        for i in range(5):
            cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
            if cap.isOpened():
                devices.append({"id": f"pc:{i}", "label": f"Câmara {i}"})
            cap.release()

    try:
        adb_path = os.path.join(os.getcwd(), "adb", "adb.exe")
        out = subprocess.run([adb_path, "devices"], capture_output=True, text=True, timeout=5).stdout
        for line in out.splitlines()[1:]:
            if "\t" not in line:
                continue
            serial, status = line.split("\t")
            if status.strip() != "device":
                continue
            model = subprocess.run(
                [adb_path, "-s", serial, "shell", "getprop", "ro.product.model"],
                capture_output=True, text=True, timeout=5,
            ).stdout.strip()
            devices.append({"id": f"phone:{serial}", "label": f"Telemóvel — {model or serial}"})
    except Exception:
        pass

    return {"cameras": devices}

def main():
    global smoothed, active_sensors

    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera", type=str, default="pc:0")
    parser.add_argument("--single-gen", action="store_true", help="Generate single image and exit")
    parser.add_argument("--list-cameras", action="store_true", help="List available cameras/phones and exit")
    parser.add_argument("--prompt", type=str, default="Ambiente sensorial calmo")
    parser.add_argument("--cfg", type=float, default=7.0)
    parser.add_argument("--steps", type=int, default=4)
    parser.add_argument("--seed", type=int, default=2252004)
    parser.add_argument("--denoising", type=float, default=0.65)
    parser.add_argument("--ref-image", type=str, default=None, help="Path to reference image")
    args, unknown = parser.parse_known_args()

    if args.list_cameras:
        print(json.dumps(list_camera_devices()))
        sys.exit(0)


    if args.single_gen:
        wrapper = None
        if _import_streamdiffusion():
            try:
                config_path = os.path.join(script_dir, "td_config.yaml")
                cfg = load_config(config_path)
                cfg['mode'] = 'img2img'
                cfg['acceleration'] = 'none'
                wrapper = create_wrapper_from_config(cfg)
            except Exception as e:
                print(json.dumps({"status": "error", "error": f"Failed to start StreamDiffusion: {e}"}))
                sys.exit(0)
        else:
            print(json.dumps({"status": "error", "error": "StreamDiffusion not available"}))
            sys.exit(0)

        try:
            # NÃO importar PIL.Image localmente: um import local torna `Image` variável
            # local de main() inteira e quebra o loop de geração (UnboundLocalError).
            import io
            import base64

            t_list = map_denoising_to_t_index(args.denoising, args.steps)
            wrapper.update_stream_params(
                guidance_scale=args.cfg,
                t_index_list=t_list,
                seed=args.seed
            )
            
            if args.ref_image and os.path.exists(args.ref_image):
                try:
                    pil_input = Image.open(args.ref_image).convert("RGB").resize((512, 512))
                except Exception as im_ex:
                    print(f"[AVISO] Falha ao ler a imagem de referencia: {im_ex}", file=sys.stderr)
                    pil_input = Image.new("RGB", (512, 512), (128, 128, 128))
            else:
                pil_input = Image.new("RGB", (512, 512), (128, 128, 128))
            
            output_pil = None
            for _ in range(args.steps + 2):
                output_pil = wrapper.img2img(pil_input, prompt=args.prompt)
                
            if output_pil:
                buffered = io.BytesIO()
                output_pil.save(buffered, format="JPEG")
                img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
                print(json.dumps({"status": "success", "image_ia": "data:image/jpeg;base64," + img_str}))
            else:
                print(json.dumps({"status": "error", "error": "No image generated"}))
        except Exception as ex:
            print(json.dumps({"status": "error", "error": str(ex)}))
        sys.exit(0)

    dominant = "Estável"
    t_reader = threading.Thread(target=_stdin_reader, daemon=True)
    t_reader.start()

    # Iniciar motor generativo multicamada em tempo real (5 camadas)
    music_thread = MusicSynthThread()
    music_thread.start()

    # Iniciar análise vocal contínua (Whisper local) + loop compensatório de homeostase
    voice_thread = VoiceAnalysisThread()
    voice_thread.start()

    # 1. Inicializar StreamDiffusion em BACKGROUND — a câmara não espera pelo modelo.
    # O import (~20 s) + carregamento para a VRAM corriam antes do VideoCapture e eram a
    # causa da demora a "ligar a câmara" no arranque do ambiente virtual.
    wrapper = None
    # `erro` viaja na telemetria (`sd_erro`): sem ele, uma falha de carregamento
    # era indistinguível de um carregamento lento — em ambos os casos a interface
    # dizia "Motor IA a carregar" e ficava-se por aí.
    _sd_bg = {"wrapper": None, "status": "loading", "erro": None}

    def _load_sd_background():
        try:
            # Dentro do try, e não antes dele: o import pode falhar de formas que
            # não são ImportError (ver `_import_streamdiffusion`), e a exceção
            # escapava daqui para cima, matando a thread de geração.
            if not _import_streamdiffusion():
                _sd_bg["status"] = "erro"
                _sd_bg["erro"] = "biblioteca StreamDiffusion indisponível"
                return
            print("[Sensus AI] A carregar motor StreamDiffusion LCM/Turbo (em background)...", file=sys.stderr)
            config_path = os.path.join(script_dir, "td_config.yaml")
            cfg = load_config(config_path)
            cfg['mode'] = 'img2img'
            # TensorRT: 80 ms por imagem contra 113 ms sem aceleração (medido numa
            # RTX 4060 Laptop), ou seja 12,5 contra 8,9 FPS. Os motores compilados
            # são específicos da GPU e da versão do TensorRT — noutra máquina são
            # reconstruídos no primeiro arranque, o que demora ~20 minutos. Por
            # isso o recurso a 'none' não é opcional: sem ele, uma falha de
            # compilação deixava o ambiente sem geração nenhuma.
            cfg['acceleration'] = 'tensorrt'
            cfg['engine_dir'] = os.path.join(script_dir, 'engines')
            # Construção do modelo dentro do cadeado partilhado — ver `_HF_LOCK`.
            # O `create_wrapper_from_config` constrói o pipeline do `diffusers`,
            # e fazê-lo ao mesmo tempo que o Depth Anything ou o Whisper deixava
            # um dos modelos em `meta` device.
            with _HF_LOCK:
                try:
                    _sd_bg["wrapper"] = create_wrapper_from_config(cfg)
                    print("[Sensus AI] StreamDiffusion pronto na VRAM (TensorRT).", file=sys.stderr)
                except Exception as ex_trt:
                    print(f"[Sensus AI] TensorRT indisponível ({ex_trt}); a usar PyTorch.", file=sys.stderr)
                    cfg['acceleration'] = 'none'
                    _sd_bg["wrapper"] = create_wrapper_from_config(cfg)
                    print("[Sensus AI] StreamDiffusion pronto na VRAM (sem aceleração).", file=sys.stderr)
            _sd_bg["status"] = "ready"
            _sd_bg["erro"] = None
        except Exception as e:
            _sd_bg["status"] = "erro"
            _sd_bg["erro"] = str(e)[:240]
            print(f"[ERRO SD] Falha ao arrancar StreamDiffusion: {e}", file=sys.stderr)

    # NÃO arranca aqui: o carregamento corre dentro da thread de geração, para o
    # wrapper ser criado e usado no mesmo contexto CUDA. Ver _sd_loop.

    # Parse camera argument
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera", type=str, default="pc:0")
    args, unknown = parser.parse_known_args()
    cam_kind, cam_ident = parse_camera_source(args.camera)

    # Iniciar câmara com base no parâmetro
    use_webcam = False
    use_simulation = False
    phone_client = None
    cap_webcam = None
    # Fora dos ramos: arrancar pelo telemóvel e trocar depois para o PC precisa
    # de saber que índice usar, e antes disto o nome só existia no ramo "pc" —
    # a troca rebentava com NameError se o motor tivesse arrancado no telemóvel.
    cam_index = int(cam_ident) if cam_kind == "pc" and cam_ident.isdigit() else 0
    #: Leituras falhadas seguidas da webcam. Uma câmara desligada a meio da
    #: sessão dava `continue` para sempre: sem imagem, sem telemetria, sem erro.
    falhas_webcam = 0
    #: Desde quando o telemóvel está ligado e sem entregar imagem. O
    #: `scrcpy.Client` diz-se vivo sem nunca mandar um frame — ecrã bloqueado,
    #: autorização de espelhamento por aceitar, servidor a arrancar — e o laço
    #: ficava à espera dele para sempre. Ver `TELEFONE_SEM_IMAGEM_S`.
    tele_sem_imagem_desde = None

    if cam_kind == "pc":
        print(f"[Sensus AI] A iniciar câmara local (webcam índice {cam_index})...", file=sys.stderr)
        cap_webcam = abrir_webcam(cam_index)
        use_webcam = cap_webcam is not None
        use_simulation = not use_webcam
        camera_estado.update(
            fonte=f"pc:{cam_index}" if use_webcam else "simulacao",
            erro=None if use_webcam else f"a webcam {cam_index} não abriu")
    else:
        phone_client = conectar_telefone(cam_ident or None)
        if phone_client:
            camera_estado.update(fonte=f"phone:{cam_ident}", erro=None)
        else:
            print("[AVISO] Telemóvel não detetado. A tentar câmara local (webcam)...", file=sys.stderr)
            cap_webcam = abrir_webcam(cam_index)
            use_webcam = cap_webcam is not None
            use_simulation = not use_webcam
            camera_estado.update(
                fonte=f"pc:{cam_index}" if use_webcam else "simulacao",
                erro="telemóvel não detetado")

    # MediaPipe FaceMesh
    from mediapipe.python.solutions import face_mesh as mp_face_mesh
    face_mesh = mp_face_mesh.FaceMesh(
        static_image_mode=False,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    # Parametria Dinâmica (sliders)
    user_prompt = "blue rose in a purple room"
    cfg_scale = 1.0
    denoising_strength = 0.65
    # Prompt por quadrante de Russell. Vazio = usa a prompt única (user_prompt).
    prompts_quadrante = {q: "" for q in _QUADRANTES}
    # Último denoising efetivamente aplicado, para não reaplicar por nada.
    ultimo_denoising_aplicado = [0.65]
    num_inference_steps = 1
    seed_val = 2252004

    # Sistema de nodes (grafo do Ambiente Virtual) — ver node_graph.py.
    # Variáveis locais de main() (mesmo padrão dos sliders acima): SET_GRAPH/
    # LOAD_EXHIBITION reatribuem-nas diretamente, sem `global`.
    active_graph = {"nodes": [], "connections": []}
    graph_runtime_state = node_graph.GraphState()
    exhibition_state = {"streamdiffusionEnabled": True, "depthMapEnabled": False,
                        "airPaintingEnabled": False, "fluidEnabled": False,
                        # Biometria facial. Desligada nos ambientes que não a usam:
                        # a malha de rosto custa ~23 ms/frame (medido) e é puro
                        # desperdício onde nada a consome.
                        "faceTrackingEnabled": True,
                        # Falso até chegar o primeiro LOAD_EXHIBITION.
                        "carregada": False,
                        # A peça espera por um aceno antes de acordar. Ver
                        # `DetectorDeAceno`: enquanto espera, não há som nem
                        # imagem gerada, só a biometria a aquecer por trás.
                        "aguardaSaudacao": False}
    detector_aceno = DetectorDeAceno()
    _saudacao_hands = {"modelo": None, "falhou": False}
    # Valor que o `synth_active` retoma quando a saudação terminar — o ambiente
    # pode ser um dos que não têm música de todo.
    synth_apos_saudacao = [True]
    # Frame externo a servir de entrada ao StreamDiffusion (ambiente Fluid AI: a
    # simulação corre na GPU do frontend e é enviada para cá). Guarda-se só o
    # último — se chegarem mais depressa do que o img2img os consome, o certo é
    # gerar sobre o mais recente, não acumular uma fila com atraso crescente.
    sd_input_externo = {"frame": None}
    # Pedido de calibracao da distancia, consumido no proximo frame com rosto.
    pending_distance_calib = {"cm": None}
    # Cenario com efeito: imagem fixa a que se aplicam as ferramentas 3D.
    # estado: idle | pendente | a_calcular | pronto | erro
    bg_still = {"pedido_b64": None, "depth_b64": None, "estado": "idle"}
    carregar_calibracao()
    last_node_params = {"value": None}
    last_output_frame = {"value": None}  # alimenta o node `generated_image` (feedback)
    _engine_start_time = time.monotonic()  # base para context["time"] (geradores CHOP)

    # Parâmetros manuais da Depth Map Tools (exp1) — mesmo padrão dos sliders
    # de StreamDiffusion acima: só valem quando o grafo não tem um node
    # `depth_viz_output` a sobrepor-se (grafo vazio por omissão nesta exposição).
    manual_depth_params = {
        "technique": "point_cloud", "colorMode": "Rainbow", "baseColor": "#00f0ff",
        "amplitude": 3.0, "contrast": 1.5, "threshold": 0.05,
        "pointSize": 3.0, "resolution": 256, "waveSize": 0.0, "waveSpeed": 1.0,
        # Realce da silhueta (0 desliga) e degraus de profundidade (0 = superfície
        # contínua). Valem para todas as técnicas, não só para a nuvem de pontos.
        "glow": 0.8, "slices": 0,
    }
    # Câmara da cena 3D quando o grafo não traz um node `camera_3d`. A órbita
    # automática é o que faz a peça respirar sozinha numa projeção sem ninguém ao
    # teclado — sem ela, a cena fica congelada de frente até alguém arrastar o
    # rato, que numa instalação não acontece.
    manual_depth_camera = {"fov": 50, "distance": 12, "autoOrbit": False, "orbitSpeed": 0.6}
    # Carimbo e mapa já codificados, para não repetir o JPEG de um mapa que não
    # mudou. Ver a codificação do `depth_map` no fim do ciclo.
    ultimo_depth = {"t": -1.0, "mapa": None, "b64": None}

    # rPPG
    roi_buffer = deque(maxlen=300)
    historico_bpm = deque(maxlen=20)
    bpm_suavizado = None
    # Instante do último cálculo de BPM. O POS_WANG corre sobre uma janela de 4 s
    # e a frequência cardíaca não muda de forma percetível entre frames
    # consecutivos, por isso recalcular a cada frame era ~97% trabalho repetido:
    # 123 ms/frame medidos, quase metade do tempo de frame do motor.
    ultimo_rppg = 0.0

    # Calibração
    CALIBRATION_FRAMES = 60
    calibrating = True
    calib_buffer = []
    calib_inicio = None   # arranca no primeiro frame com cara, não aqui
    baselines = {
        "browSqueeze": 0.22,     "browElevation": 0.24,
        "outerBrowElevation": 0.28, "mouthWidth": 0.45,
        "mouthOpen": 0.02,       "mouthTilt": 0.0,
        "eyelidAperture": 0.08,  "cheekHeight": 0.1,
        "noseWidth": 0.2,        "lipThickness": 0.05,
        "chinHeight": 0.15,      "openEAR": 0.28,
    }

    # Smoothing — eixos dimensionais de Russell (sem emoções discretas)
    alpha = 0.22
    smoothed = {
        "bpm": 0, "val": 0, "aro": 0,
        "positivo": 0.0, "negativo": 0.0, "ativado": 0.0, "nao_ativado": 1.0,
        "AU1": 0, "AU2": 0, "AU4": 0, "AU5": 0, "AU6": 0, "AU9": 0,
        "AU12": 0, "AU15": 0, "AU17": 0, "AU20": 0, "AU23": 0, "AU25": 0, "AU26": 0,
        "pitch": 0, "yaw": 0, "roll": 0,
        "ear_l": 0.3, "ear_r": 0.3, "sym": 1.0, "iris": 0.0,
        # Ultima distancia estimada valida, para o grafo de nodes. Mantem-se o
        # ultimo valor bom quando nao ha rosto ou a estimativa cai fora do
        # intervalo aceite — um parametro visual a saltar para zero a cada
        # frame ruidosa era pior do que ficar parado. Arranca a 70 cm, distancia
        # tipica de quem esta sentado, para o visual nao comecar no extremo do
        # intervalo enquanto nenhum rosto foi visto.
        "dist_cm": 70.0,
    }

    # Blink detection
    blink_count = 0
    blink_cooldown = False
    blink_cooldown_end = 0

    # FPS tracking
    frame_count = 0
    fps_time = time.time()
    current_fps = 0

    # Gaze fixation state variables
    last_quadrant = -1
    fixation_start_time = time.time()
    fixation_duration = 0.0

    print("[Sensus AI] Pipeline biométrico e gerador ativo.", file=sys.stderr)

    # Último frame cru capturado — usado pelo SINGLE_GEN quando não há imagem de referência
    last_capture = {"raw": None}

    # Deteção de colapso NaN (fp16): quando os latents ficam NaN, o pipeline
    # realimenta-os (x_t_latent_buffer / stock_noise) e o output fica preto
    # para sempre. Contam-se frames pretos consecutivos e repõe-se o estado.
    # A contagem vive em _sd_job["pretos"], junto de quem gera.
    SD_BLACK_LIMIT = 4

    def _recover_sd_state(w):
        # Repor os buffers de latents persistentes ao estado inicial (ver
        # pipeline.py: x_t_latent_buffer=zeros, stock_noise=zeros_like,
        # init_noise=randn) para expulsar NaNs auto-perpetuados.
        try:
            import torch
            stream = getattr(w, "stream", None)
            if stream is None:
                return False
            buf = getattr(stream, "x_t_latent_buffer", None)
            if buf is not None:
                stream.x_t_latent_buffer = torch.zeros_like(buf)
            noise = getattr(stream, "stock_noise", None)
            if noise is not None:
                stream.stock_noise = torch.zeros_like(noise)
            init = getattr(stream, "init_noise", None)
            if init is not None:
                stream.init_noise = torch.randn(
                    init.shape, dtype=init.dtype, device=init.device
                )
            print("[SD RECOVER] Latents repostos após colapso (frames pretos).", file=sys.stderr)
            return True
        except Exception as e:
            print(f"[SD RECOVER ERRO] {e}", file=sys.stderr)
            return False

    # ── Geração em thread própria ──
    # Slot único partilhado com o ciclo principal: ele deposita o último frame de
    # entrada, esta thread deposita a última imagem gerada. Nenhuma das duas
    # espera pela outra, que é o ponto — o img2img é lento (~50 ms medidos, sem
    # TensorRT nem xformers nesta instalação) e não tem de arrastar consigo a
    # captura, a biometria e a telemetria.
    _sd_job = {"lock": threading.Lock(), "entrada": None, "prompt": "",
               "wrapper": None, "saida": None, "saida_jpeg": None, "fps": 0.0,
               "parar": False}

    def _upscale_gpu(t):
        """Amplia e afia o tensor gerado, sem o tirar da VRAM.

        `t` chega em (B, C, H, W), float, 0..1, na GPU — é o que o wrapper devolve
        com `output_type="pt"`. Toda a operação corre em CUDA; a única passagem
        para a CPU é a conversão final para uint8, que já existia antes.

        Bicúbico e não um modelo de super-resolução: numa RTX 4060 Laptop o
        StreamDiffusion já consome a VRAM e o tempo de frame quase todos.
        A máscara de nitidez (unsharp) devolve o contorno que a ampliação lava.

        Remedido a 2026-09-17 (RTX 4060 Laptop), por imagem gerada — ampliação,
        nitidez e cópia para a CPU, tudo somado:
            1,0×  →  0,31 ms   ·  512²  ·  JPEG 0,40 ms  ·  23 kB
            2,0×  →  1,30 ms   · 1024²  ·  JPEG 1,59 ms  ·  64 kB
            3,0×  →  4,11 ms   · 1536²  ·  JPEG 3,35 ms  · 118 kB
            4,0×  →  6,61 ms   · 2048²  ·  JPEG 6,50 ms  · 184 kB
        (JPEG q75 sobre uma imagem real; com ruído puro a compressão custa 7×
        mais, e era daí que vinham os 12 ms atribuídos antes ao 1024².)

        Nada disto é o travão. O travão era o `imencode` correr no **ciclo
        principal**, uma vez por frame capturado — a mesma imagem gerada
        recodificada ~30×/s quando a geração só produz ~15. Passou a ser
        codificada aqui, na thread que a produz, uma vez por imagem: o custo
        deixou de depender da taxa da câmara e o teto do comando subiu de 3× para
        4×.

        ponytail: para qualidade a sério, um Real-ESRGAN Compact ×2 em TensorRT
        entra aqui, com o custo de mais um motor e mais VRAM.
        """
        import torch.nn.functional as F
        fator = float(upscale_cfg["fator"])
        nitidez = float(upscale_cfg["nitidez"])
        if fator > 1.001:
            t = F.interpolate(t, scale_factor=fator, mode="bicubic", align_corners=False)
        if nitidez > 0.001:
            # Desfoque de média 3×3 com passo 1: mantém o tamanho e é a operação
            # mais barata que serve de referência à máscara de nitidez.
            desfocado = F.avg_pool2d(t, kernel_size=3, stride=1, padding=1)
            t = t + nitidez * (t - desfocado)
        return t.clamp(0.0, 1.0)

    def _tensor_para_bgr(t):
        """(B,C,H,W) 0..1 na GPU → imagem BGR uint8 para o OpenCV."""
        arr = (t[0].permute(1, 2, 0) * 255.0).to(torch.uint8).cpu().numpy()
        return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)

    def _sd_loop():
        # Espera pela exposição antes de decidir se carrega o StreamDiffusion.
        # Nos ambientes que não o usam (Depth Map Tools, Air Painting) carregá-lo
        # gastava ~2 GB de VRAM e um minuto de arranque para nada — e punha o
        # import de `transformers` a competir com o do Depth Anything noutra
        # thread, o que fazia um dos dois falhar a meio do import.
        limite = time.time() + 5.0
        while not _sd_job["parar"] and not exhibition_state["carregada"] and time.time() < limite:
            time.sleep(0.05)

        carregado = False
        contador, marco = 0, time.time()
        prompt_aplicada = None
        while not _sd_job["parar"]:
            if not carregado:
                if not exhibition_state["streamdiffusionEnabled"]:
                    _sd_bg["status"] = "desligado"
                    time.sleep(0.25)
                    continue
                # O carregamento acontece aqui, e não numa thread à parte, porque
                # o TensorRT executa no contexto CUDA de quem criou os motores.
                # Criados noutra thread, cada geração pagava sincronização entre
                # contextos: 0,6 FPS medidos, contra 15 quando é a mesma thread.
                _load_sd_background()
                carregado = True
            with _sd_job["lock"]:
                entrada = _sd_job["entrada"]
                prompt = _sd_job["prompt"]
                w = _sd_job["wrapper"]
                _sd_job["entrada"] = None      # consome: não repete o mesmo frame
            if entrada is None or w is None:
                time.sleep(0.004)
                continue
            try:
                pil_input = Image.fromarray(cv2.cvtColor(entrada, cv2.COLOR_BGR2RGB))
                # A prompt só é reenviada quando muda. Passá-la ao img2img faz o
                # wrapper correr o update_prompt, que reencoda o texto pelo CLIP:
                # 30 ms medidos, por imagem. Como a prompt só muda quando o BPM
                # muda (1×/s) ou o utilizador a edita, saltar essa repetição vale
                # ~24% do tempo de geração.
                if prompt != prompt_aplicada:
                    w.update_prompt(prompt)
                    prompt_aplicada = prompt
                # Tensor em vez de PIL: assim a imagem fica na VRAM e o upscale
                # acontece antes de haver qualquer cópia para a RAM. Idempotente,
                # para aguentar uma substituição do wrapper em recuperação.
                if getattr(w, "output_type", None) != "pt":
                    w.output_type = "pt"
                saida_t = w.img2img(pil_input)
                saida = _tensor_para_bgr(_upscale_gpu(saida_t))

                # Colapso NaN fp16 → output preto puro que nunca recupera sozinho.
                nonlocal_pretos = _sd_job.get("pretos", 0)
                if saida.max() < 5:
                    nonlocal_pretos += 1
                    if nonlocal_pretos >= SD_BLACK_LIMIT:
                        _recover_sd_state(w)
                        nonlocal_pretos = 0
                else:
                    nonlocal_pretos = 0
                _sd_job["pretos"] = nonlocal_pretos

                contador += 1
                agora = time.time()
                if agora - marco >= 1.0:
                    _sd_job["fps"] = contador / (agora - marco)
                    contador, marco = 0, agora
                # JPEG aqui e não no ciclo principal: é aqui que a imagem nasce,
                # uma vez por geração. No ciclo principal era recodificada a cada
                # frame capturado — a mesma imagem, ~30×/s, e o custo cresce com o
                # quadrado do fator de ampliação. Ver `_upscale_gpu`.
                _, _enc_ia = cv2.imencode(".jpg", saida, [cv2.IMWRITE_JPEG_QUALITY, 75])
                jpeg_ia = ("data:image/jpeg;base64,"
                           + base64.b64encode(_enc_ia).decode("utf-8"))
                with _sd_job["lock"]:
                    _sd_job["saida"] = saida
                    _sd_job["saida_jpeg"] = jpeg_ia
            except Exception as e:
                print(f"[SD LOOP ERRO] {e}", file=sys.stderr)
                time.sleep(0.05)

    def _sd_loop_guardado():
        """Última rede: uma exceção fora do try interno matava esta thread e a
        geração ficava presa em "loading" sem uma linha de erro em lado nenhum.
        Foi assim que a falha de import do `transformers` passou despercebida."""
        try:
            _sd_loop()
        except BaseException as e:
            _sd_bg["status"] = "erro"
            _sd_bg["erro"] = f"thread de geração terminou: {str(e)[:200]}"
            traceback.print_exc(file=sys.stderr)

    threading.Thread(target=_sd_loop_guardado, daemon=True, name="streamdiffusion").start()

    def _apply_sd_params(w, **kwargs):
        # Um slider NUNCA pode matar o loop principal: qualquer erro do pipeline
        # (CUDA OOM, shapes em recalculação estrutural, etc.) fica contido aqui.
        try:
            w.update_stream_params(**kwargs)
            return True
        except Exception as ex:
            print(f"[SD PARAM ERRO] {ex}", file=sys.stderr)
            return False

    running = True
    while running:
        # Processar comandos do stdin. Parâmetros SD são coalescidos: um drag de
        # slider gera dezenas de comandos por segundo — só o último valor conta,
        # aplicado UMA vez por ciclo (update_stream_params estrutural é caro).
        pending_sd = {}
        for cmd_raw in get_commands():
            if cmd_raw == "CALIBRATE":
                calibrating = True
                calib_buffer = []
                calib_inicio = None
                print("[Sensus AI] Calibração manual iniciada.", file=sys.stderr)
            elif cmd_raw.startswith("SET_CAMERA_SOURCE "):
                req_src = cmd_raw[18:].strip()
                req_kind, req_ident = parse_camera_source(req_src)
                req_kind = req_kind.lower()
                print(f"[Sensus AI] Mudar fonte de imagem para {req_src}", file=sys.stderr)
                if req_kind == "pc":
                    novo_indice = int(req_ident) if req_ident.isdigit() else 0
                    # Fechar a que estava. Antes a reabertura era condicionada a
                    # `not cap_webcam.isOpened()`, e por isso escolher a câmara 1
                    # com a 0 aberta não fazia absolutamente nada.
                    if cap_webcam:
                        cap_webcam.release()
                        cap_webcam = None
                    if phone_client:
                        phone_client.stop()
                        phone_client = None
                    cam_index = novo_indice
                    cap_webcam = abrir_webcam(cam_index)
                    use_webcam = cap_webcam is not None
                    use_simulation = not use_webcam
                    falhas_webcam = 0
                    camera_estado.update(
                        fonte=f"pc:{cam_index}" if use_webcam else "simulacao",
                        erro=None if use_webcam else f"a webcam {cam_index} não abriu")
                elif req_kind == "phone":
                    if cap_webcam:
                        cap_webcam.release()
                        cap_webcam = None
                    if phone_client:
                        phone_client.stop()
                        phone_client = None
                    phone_client = conectar_telefone(req_ident or None)
                    use_webcam = False
                    use_simulation = False
                    tele_sem_imagem_desde = None
                    if phone_client:
                        camera_estado.update(fonte=f"phone:{req_ident}", erro=None)
                    else:
                        # Volta para a câmara do PC, não para a simulação: perder
                        # o telemóvel não é motivo para a peça deixar de medir
                        # ninguém, e era daqui que a sessão saía sem imagem.
                        print("[AVISO] Telemóvel não detetado. A voltar à câmara do PC.", file=sys.stderr)
                        cap_webcam = abrir_webcam(cam_index)
                        use_webcam = cap_webcam is not None
                        use_simulation = not use_webcam
                        falhas_webcam = 0
                        camera_estado.update(
                            fonte=f"pc:{cam_index}" if use_webcam else "simulacao",
                            erro="telemóvel não detetado")
            elif cmd_raw == "QUIT":
                running = False
                break
            elif cmd_raw.startswith("SET_PROMPT "):
                user_prompt = cmd_raw[11:]
            elif cmd_raw.startswith("SET_PROMPT_QUADRANT "):
                # Formato: SET_PROMPT_QUADRANT <quadrante> <texto>
                try:
                    _, quad, texto = cmd_raw.split(" ", 2)
                    if quad in prompts_quadrante:
                        prompts_quadrante[quad] = texto.strip()
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_CFG "):
                try:
                    cfg_scale = max(1.0, min(15.0, float(cmd_raw[8:])))
                    pending_sd["cfg"] = True
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_DENOISING "):
                try:
                    denoising_strength = max(0.10, min(0.95, float(cmd_raw[14:])))
                    pending_sd["t_index"] = True
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_STEPS "):
                try:
                    # Cada passo extra multiplica o batch de denoising: FPS cai de
                    # forma proporcional. Limitado a 1-2 por decisão do utilizador;
                    # _apply_sd_params contém qualquer falha (ex.: OOM) sem matar o loop.
                    num_inference_steps = max(1, min(2, int(cmd_raw[10:])))
                    pending_sd["t_index"] = True
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_SYNTH_BASE_F0 "):
                try:
                    global synth_base_f0
                    synth_base_f0 = float(cmd_raw[18:])
                except Exception:
                    pass
            elif cmd_raw.startswith("SET_SYNTH_TIMBRE "):
                try:
                    global synth_timbre
                    synth_timbre = float(cmd_raw[17:])
                except Exception:
                    pass
            elif cmd_raw.startswith("SET_SYNTH_VOLUME "):
                try:
                    global synth_volume
                    synth_volume = float(cmd_raw[17:])
                except Exception:
                    pass
            elif cmd_raw.startswith("SET_SEED "):
                try:
                    seed_val = int(cmd_raw[9:])
                    pending_sd["seed"] = True
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_SCALE "):
                req = cmd_raw[10:].strip().lower()
                user_music["scale"] = req if req in _SCALES else None
            elif cmd_raw.startswith("SET_TEMPO "):
                try:
                    user_music["bpm_mult"] = max(0.5, min(1.5, float(cmd_raw[10:])))
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_BRIGHTNESS "):
                try:
                    user_music["cutoff_mult"] = max(0.3, min(1.5, float(cmd_raw[15:])))
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_SYNTH_ACTIVE "):
                # Mute explícito do utilizador: o stream de áudio continua vivo
                # (watchdog intacto) — apenas passa a renderizar silêncio.
                global synth_active
                synth_active = cmd_raw[17:].strip() in ("1", "true", "on")
            elif cmd_raw.startswith("SET_OVERLAY_MODE "):
                # sensors → overlay biométrico; depth → mapa de profundidade
                req = cmd_raw[17:].strip().lower()
                if req in ("sensors", "depth"):
                    overlay_state["mode"] = req
                    if req == "depth":
                        depth_estimator.ensure_loading()
                    print(f"[Sensus AI] Modo de overlay: {req}", file=sys.stderr)
            elif cmd_raw.startswith("SET_ACTIVE_SENSORS "):
                try:
                    sensors_json = cmd_raw[19:].strip()
                    active_sensors = json.loads(sensors_json)
                    print(f"[Sensus AI] Sensores biométricos atualizados: {active_sensors}", file=sys.stderr)
                except Exception as ex:
                    print(f"[ERRO] Falha ao processar SET_ACTIVE_SENSORS: {ex}", file=sys.stderr)
            elif cmd_raw.startswith("SET_GRAPH "):
                try:
                    new_graph = json.loads(cmd_raw[10:])
                    node_graph.validate_graph(new_graph)
                    active_graph = new_graph
                    graph_runtime_state = node_graph.GraphState()
                    print("[Sensus AI] Grafo de nodes atualizado.", file=sys.stderr)
                except Exception as ex:
                    print(f"[GRAPH ERRO] SET_GRAPH inválido: {ex}", file=sys.stderr)
            elif cmd_raw.startswith("LOAD_EXHIBITION "):
                try:
                    exhibition = json.loads(cmd_raw[16:])
                    eng = exhibition.get("engine", {})
                    defaults = exhibition.get("defaults", {})
                    new_graph = exhibition.get("graph", {"nodes": [], "connections": []})
                    node_graph.validate_graph(new_graph)
                    sd_cfg = eng.get("streamdiffusion", {})
                    exhibition_state["streamdiffusionEnabled"] = bool(sd_cfg.get("enabled", True))
                    exhibition_state["depthMapEnabled"] = bool(eng.get("depthMap", {}).get("enabled", False))
                    exhibition_state["airPaintingEnabled"] = bool(eng.get("airPainting", {}).get("enabled", False))
                    # Ausente = ligada, para as exposições antigas continuarem iguais.
                    exhibition_state["faceTrackingEnabled"] = bool(
                        eng.get("faceTracking", {}).get("enabled", True))
                    exhibition_state["fluidEnabled"] = bool(eng.get("fluid", {}).get("enabled", False))
                    exhibition_state["carregada"] = True
                    # Entrar num ambiente novo é entrar numa sessão nova: o
                    # repouso da pessoa e o quadrante fixado não se herdam.
                    _ativacao["bpm"].limpar()
                    _ativacao["mov"].limpar()
                    redefinir_piscar()
                    redefinir_quadrante()
                    # A música generativa é exclusiva da Regulação Sensorial. Nos outros
                    # ambientes o stream FICA ABERTO (o watchdog não pode ser tocado) e o
                    # callback entrega silêncio — antes tocava por baixo de todos eles, só
                    # que sem controlos na interface. `global` já foi declarado no
                    # SET_SYNTH_ACTIVE acima e vale para toda a função.
                    synth_active = not (exhibition_state["depthMapEnabled"]
                                        or exhibition_state["airPaintingEnabled"]
                                        or exhibition_state["fluidEnabled"])
                    # Saudação: a peça só acorda quando alguém acenar. O som fica
                    # em silêncio pelo `synth_active` — o stream NÃO se fecha e o
                    # watchdog não é tocado, é o mesmo caminho que os ambientes
                    # sem música já usam.
                    synth_apos_saudacao[0] = synth_active
                    exhibition_state["aguardaSaudacao"] = bool(
                        eng.get("saudacao", {}).get("enabled", False))
                    detector_aceno.limpar()
                    if exhibition_state["aguardaSaudacao"]:
                        synth_active = False
                        print("[Sensus AI] À espera de um aceno para começar.", file=sys.stderr)
                    if exhibition_state["airPaintingEnabled"]:
                        air_painter.limpar()  # cada entrada no ambiente começa com a tela vazia
                    sd_input_externo["frame"] = None
                    user_prompt = sd_cfg.get("basePrompt", user_prompt)
                    # Prompts por quadrante vindas do ficheiro do ambiente. Sem
                    # elas, a imagem visita os quatro quadrantes mas cai sempre
                    # na prompt única — varia em denoising, não em conteúdo.
                    # Só as chaves conhecidas, e só as não vazias: o painel pode
                    # depois sobrepor qualquer uma com SET_PROMPT_QUADRANT.
                    for quad, texto in (sd_cfg.get("quadrantPrompts") or {}).items():
                        if quad in prompts_quadrante and isinstance(texto, str):
                            prompts_quadrante[quad] = texto.strip()
                    cfg_scale = float(defaults.get("cfg", cfg_scale))
                    denoising_strength = float(defaults.get("denoising", denoising_strength))
                    num_inference_steps = int(defaults.get("steps", num_inference_steps))
                    seed_val = int(defaults.get("seed", seed_val))
                    pending_sd["cfg"] = True
                    pending_sd["t_index"] = True
                    pending_sd["seed"] = True
                    if "activeSensors" in defaults:
                        active_sensors = defaults["activeSensors"]
                    for layer, vol in defaults.get("music", {}).get("layers", {}).items():
                        if layer in audio_layers:
                            audio_layers[layer]["vol"] = float(vol)
                    depth_defaults = defaults.get("depthViz", {})
                    for key in manual_depth_params:
                        if key in depth_defaults:
                            manual_depth_params[key] = depth_defaults[key]
                    active_graph = new_graph
                    graph_runtime_state = node_graph.GraphState()
                    last_node_params["value"] = None
                    print(f"[Sensus AI] Exposição carregada: {exhibition.get('name', exhibition.get('id', '?'))}", file=sys.stderr)
                except Exception as ex:
                    print(f"[GRAPH ERRO] LOAD_EXHIBITION inválido: {ex}", file=sys.stderr)
            elif cmd_raw.startswith("SET_BG_IMAGE "):
                # Imagem de cenario a que as ferramentas 3D vao ser aplicadas.
                # Guardada como pedido; a profundidade e calculada no loop, so
                # depois do modelo estar pronto.
                bg_still["pedido_b64"] = cmd_raw[13:].strip()
                bg_still["estado"] = "pendente"
                bg_still["depth_b64"] = None
                print(f"[BG] Imagem de cenario recebida ({len(bg_still['pedido_b64'])} chars).",
                      file=sys.stderr)
            elif cmd_raw.startswith("CLEAR_BG_IMAGE"):
                bg_still.update({"pedido_b64": None, "depth_b64": None, "estado": "idle"})
                print("[BG] Imagem de cenario removida.", file=sys.stderr)
            elif cmd_raw.startswith("SET_SD_INPUT_IMAGE "):
                # Frame externo (ambiente Fluid AI) a substituir a câmara como
                # entrada do img2img. Descodifica-se aqui, no leitor de comandos,
                # para o ciclo principal só encontrar a matriz já pronta.
                try:
                    bruto = base64.b64decode(cmd_raw[19:].strip())
                    img = cv2.imdecode(np.frombuffer(bruto, dtype=np.uint8), cv2.IMREAD_COLOR)
                    if img is not None:
                        sd_input_externo["frame"] = img
                except Exception as ex:
                    print(f"[SD IN ERRO] Frame externo inválido: {ex}", file=sys.stderr)
            # ── Air Painting ──
            # Equivalentes aos atalhos de teclado de um protótipo em janela OpenCV
            # ('c' limpar, '+'/'-' limiar): aqui os controlos vivem no painel, que
            # é onde o utilizador do hub está.
            elif cmd_raw.startswith("AIRPAINT_CLEAR"):
                air_painter.limpar()
            elif cmd_raw.startswith("AIRPAINT_UNDO"):
                air_painter.anular()
            elif cmd_raw.startswith("SET_AIRPAINT_ERASER "):
                air_painter.borracha = cmd_raw.split()[1].strip().lower() in ("1", "true", "on")
            elif cmd_raw.startswith("SET_AIRPAINT_GESTURE_WIDTH "):
                air_painter.espessura_por_gesto = cmd_raw.split()[1].strip().lower() in ("1", "true", "on")
            elif cmd_raw.startswith("SET_AIRPAINT_WIDTH_RANGE "):
                # Formato: SET_AIRPAINT_WIDTH_RANGE <min> <max>
                try:
                    partes = cmd_raw.split()
                    lo = int(max(1, min(60, float(partes[1]))))
                    hi = int(max(1, min(60, float(partes[2]))))
                    air_painter.espessura_min, air_painter.espessura_max = min(lo, hi), max(lo, hi)
                except Exception:
                    pass
            elif cmd_raw.startswith("SET_AIRPAINT_THRESHOLD "):
                try:
                    air_painter.limiar = int(max(0, min(255, float(cmd_raw.split()[1]))))
                except Exception:
                    pass
            elif cmd_raw.startswith("SET_AIRPAINT_THICKNESS "):
                try:
                    air_painter.espessura = int(max(1, min(40, float(cmd_raw.split()[1]))))
                except Exception:
                    pass
            elif cmd_raw.startswith("SET_AIRPAINT_SMOOTHING "):
                try:
                    air_painter.suavizacao = max(0.0, min(0.95, float(cmd_raw.split()[1])))
                except Exception:
                    pass
            elif cmd_raw.startswith("SET_AIRPAINT_COLOR "):
                try:
                    h = cmd_raw.split()[1].strip().lstrip("#")
                    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
                    air_painter.cor = (b, g, r)  # OpenCV trabalha em BGR
                except Exception:
                    pass
            elif cmd_raw.startswith("SET_AIRPAINT_COLOR2 "):
                try:
                    h = cmd_raw.split()[1].strip().lstrip("#")
                    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
                    air_painter.cor_secundaria = (b, g, r)
                except Exception:
                    pass
            elif cmd_raw.startswith("SET_UPSCALE "):
                # SET_UPSCALE <fator> [nitidez] — fator 1.0 desliga a ampliação.
                try:
                    partes = cmd_raw.split()
                    upscale_cfg["fator"] = max(1.0, min(4.0, float(partes[1])))
                    if len(partes) > 2:
                        upscale_cfg["nitidez"] = max(0.0, min(2.0, float(partes[2])))
                except Exception:
                    pass
            elif cmd_raw.startswith("SET_CAMERA_MIRROR "):
                camera_mirror["on"] = cmd_raw.split()[1].strip().lower() in ("1", "true", "on")
            elif cmd_raw.startswith("SET_AIRPAINT_MIRROR "):
                air_painter.espelhar = cmd_raw.split()[1].strip().lower() in ("1", "true", "on")
            elif cmd_raw.startswith("SET_AIRPAINT_SWAP_HANDS "):
                air_painter.trocar_maos = cmd_raw.split()[1].strip().lower() in ("1", "true", "on")
            elif cmd_raw.startswith("SET_AIRPAINT_REQUIRE_DEPTH "):
                air_painter.exigir_profundidade = cmd_raw.split()[1].strip().lower() in ("1", "true", "on")
            elif cmd_raw.startswith("SET_AIRPAINT_PEN "):
                caneta = cmd_raw.split()[1].strip()
                if caneta in _CANETAS:
                    air_painter.caneta = caneta
            elif cmd_raw.startswith("SET_AIRPAINT_LAYER "):
                try:
                    i = int(cmd_raw.split()[1])
                    if 0 <= i < _NUM_CAMADAS:
                        air_painter.camada_ativa = i
                        air_painter._terminar_traco()
                except Exception:
                    pass
            elif cmd_raw.startswith("SET_AIRPAINT_LAYER_OPACITY "):
                # Formato: SET_AIRPAINT_LAYER_OPACITY <indice> <0..1>
                try:
                    partes = cmd_raw.split()
                    i, v = int(partes[1]), float(partes[2])
                    if 0 <= i < len(air_painter.camadas):
                        air_painter.camadas[i]["opacidade"] = max(0.0, min(1.0, v))
                except Exception:
                    pass
            elif cmd_raw.startswith("SET_AIRPAINT_LAYER_BLEND "):
                try:
                    partes = cmd_raw.split()
                    i, modo = int(partes[1]), partes[2].strip()
                    if 0 <= i < len(air_painter.camadas) and modo in ("normal", "adicionar", "multiplicar", "ecra"):
                        air_painter.camadas[i]["mistura"] = modo
                except Exception:
                    pass
            elif cmd_raw.startswith("SET_AIRPAINT_LAYER_VISIBLE "):
                try:
                    partes = cmd_raw.split()
                    i = int(partes[1])
                    if 0 <= i < len(air_painter.camadas):
                        air_painter.camadas[i]["visivel"] = partes[2].strip().lower() in ("1", "true", "on")
                except Exception:
                    pass
            elif cmd_raw.startswith("CLEAR_AIRPAINT_LAYER "):
                try:
                    i = int(cmd_raw.split()[1])
                    if 0 <= i < len(air_painter.camadas):
                        air_painter._arquivar()
                        air_painter.camadas[i]["canvas"][:] = 0
                        air_painter.camadas[i]["mascara"][:] = 0
                        air_painter.camadas[i]["vazia"] = True
                        air_painter._terminar_traco()
                except Exception:
                    pass
            elif cmd_raw.startswith("CHESSBOARD_CALIB_START"):
                # Formato: CHESSBOARD_CALIB_START [colunas] [linhas] [alvo]
                partes = cmd_raw.split()
                try:
                    cols = int(partes[1]) if len(partes) > 1 else 9
                    rows = int(partes[2]) if len(partes) > 2 else 6
                    alvo = int(partes[3]) if len(partes) > 3 else 15
                except ValueError:
                    cols, rows, alvo = 9, 6, 15
                chessboard_calib.update({
                    "ativa": True, "padrao": (cols, rows), "alvo": max(5, alvo),
                    "objpoints": [], "imgpoints": [], "ultimo_t": 0.0,
                    "estado": "a_recolher", "mensagem": "",
                })
                print(f"[CALIB] Tabuleiro iniciado: {cols}x{rows} cantos, "
                      f"{alvo} vistas.", file=sys.stderr)
            elif cmd_raw.startswith("CHESSBOARD_CALIB_CANCEL"):
                chessboard_calib.update({
                    "ativa": False, "objpoints": [], "imgpoints": [],
                    "estado": "idle", "mensagem": "",
                })
                print("[CALIB] Tabuleiro cancelado.", file=sys.stderr)
            elif cmd_raw.startswith("CALIB_RESET"):
                distance_calib["focal_px"] = None
                distance_calib["fonte"] = None
                chessboard_calib.update({"estado": "idle", "mensagem": ""})
                try:
                    if os.path.exists(CALIB_FICHEIRO):
                        os.remove(CALIB_FICHEIRO)
                except Exception:
                    pass
                print("[CALIB] Calibracao apagada; volta ao FOV suposto.", file=sys.stderr)
            elif cmd_raw.startswith("CALIBRATE_DISTANCE "):
                # Substitui a focal suposta por uma medida real: o utilizador
                # coloca-se a uma distancia conhecida e envia esse valor em cm.
                try:
                    pending_distance_calib["cm"] = float(cmd_raw[19:].strip())
                except ValueError:
                    print("[ERRO] CALIBRATE_DISTANCE espera um numero em cm.", file=sys.stderr)
            elif cmd_raw.startswith("SET_DEPTH_TECHNIQUE "):
                manual_depth_params["technique"] = cmd_raw[20:].strip()
            elif cmd_raw.startswith("SET_DEPTH_COLORMODE "):
                manual_depth_params["colorMode"] = cmd_raw[20:].strip()
            elif cmd_raw.startswith("SET_DEPTH_BASECOLOR "):
                manual_depth_params["baseColor"] = cmd_raw[20:].strip()
            elif cmd_raw.startswith("SET_DEPTH_AMPLITUDE "):
                try:
                    manual_depth_params["amplitude"] = max(0.0, min(10.0, float(cmd_raw[20:])))
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_DEPTH_CONTRAST "):
                try:
                    manual_depth_params["contrast"] = max(0.1, min(3.0, float(cmd_raw[19:])))
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_DEPTH_THRESHOLD "):
                try:
                    manual_depth_params["threshold"] = max(0.0, min(1.0, float(cmd_raw[20:])))
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_DEPTH_POINTSIZE "):
                try:
                    manual_depth_params["pointSize"] = max(0.5, min(20.0, float(cmd_raw[20:])))
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_DEPTH_RESOLUTION "):
                try:
                    manual_depth_params["resolution"] = max(32, min(1024, int(cmd_raw[21:])))
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_DEPTH_WAVESIZE "):
                try:
                    manual_depth_params["waveSize"] = max(0.0, min(2.0, float(cmd_raw[19:])))
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_DEPTH_WAVESPEED "):
                try:
                    manual_depth_params["waveSpeed"] = max(0.0, min(10.0, float(cmd_raw[20:])))
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_DEPTH_GLOW "):
                try:
                    manual_depth_params["glow"] = max(0.0, min(3.0, float(cmd_raw[15:])))
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_DEPTH_SLICES "):
                try:
                    manual_depth_params["slices"] = max(0, min(32, int(float(cmd_raw[17:]))))
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_DEPTH_ORBIT "):
                manual_depth_camera["autoOrbit"] = cmd_raw[16:].strip().lower() in ("1", "true", "on")
            elif cmd_raw.startswith("SET_DEPTH_ORBITSPEED "):
                try:
                    manual_depth_camera["orbitSpeed"] = max(0.0, min(5.0, float(cmd_raw[21:])))
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_DEPTH_CAMDIST "):
                try:
                    manual_depth_camera["distance"] = max(2.0, min(50.0, float(cmd_raw[18:])))
                except ValueError:
                    pass
            elif cmd_raw.startswith("SET_VOLUME_"):
                # SET_VOLUME_<CAMADA> <0..1> — ganho isolado de cada uma das 5 camadas
                try:
                    head, val = cmd_raw.split(" ", 1)
                    layer = _LAYER_ALIASES.get(head[len("SET_VOLUME_"):].strip().lower())
                    if layer:
                        audio_layers[layer]["vol"] = clamp(float(val))
                except Exception:
                    pass
            elif cmd_raw.startswith("TOGGLE_"):
                # TOGGLE_<CAMADA> [0|1] — liga/desliga isoladamente cada camada
                try:
                    parts = cmd_raw.split(" ")
                    layer = _LAYER_ALIASES.get(parts[0][len("TOGGLE_"):].strip().lower())
                    if layer:
                        if len(parts) > 1:
                            audio_layers[layer]["on"] = parts[1].strip() in ("1", "true", "on")
                        else:
                            audio_layers[layer]["on"] = not audio_layers[layer]["on"]
                except Exception:
                    pass
            elif cmd_raw.startswith("SET_VOICE_ANALYSIS "):
                try:
                    voice_thread.enabled = cmd_raw[19:].strip() in ("1", "true", "on")
                    print(f"[VOZ] Análise vocal contínua: {voice_thread.enabled}", file=sys.stderr)
                except Exception:
                    pass
            elif cmd_raw.startswith("SINGLE_GEN "):
                # Geração única REUTILIZANDO o modelo já carregado — o caminho antigo
                # arrancava um 2.º processo Python que voltava a carregar o modelo
                # (60–90 s) e disputava a VRAM com este; com o ambiente ativo ficava
                # pendurado e nunca devolvia resposta.
                import io
                import base64 as _b64
                try:
                    req = json.loads(cmd_raw[11:])
                except Exception:
                    req = None
                if req is None:
                    print(json.dumps({"single_gen": {"status": "error", "error": "Pedido inválido"}}), flush=True)
                elif wrapper is None and _sd_bg["wrapper"] is None:
                    print(json.dumps({"single_gen": {"status": "error", "error": "Motor de geração ainda a carregar — tente dentro de instantes"}}), flush=True)
                else:
                    gen_w = wrapper or _sd_bg["wrapper"]
                    try:
                        g_cfg = max(1.0, min(15.0, float(req.get("cfg", cfg_scale))))
                        g_steps = max(1, min(2, int(req.get("steps", num_inference_steps))))
                        g_den = max(0.05, min(1.0, float(req.get("denoising", denoising_strength))))
                        g_seed = int(req.get("seed", seed_val))
                        g_prompt = str(req.get("prompt", user_prompt))
                        _apply_sd_params(gen_w, guidance_scale=g_cfg,
                                         t_index_list=map_denoising_to_t_index(g_den, g_steps),
                                         seed=g_seed)
                        ref_path = req.get("ref_image")
                        if ref_path and os.path.exists(ref_path):
                            pil_in = Image.open(ref_path).convert("RGB").resize((512, 512))
                        elif last_capture["raw"] is not None:
                            src = last_capture["raw"]
                            mh, mw = src.shape[:2]
                            md = min(mh, mw)
                            sq = src[(mh - md) // 2:(mh + md) // 2, (mw - md) // 2:(mw + md) // 2]
                            pil_in = Image.fromarray(cv2.cvtColor(cv2.resize(sq, (512, 512)), cv2.COLOR_BGR2RGB))
                        else:
                            pil_in = Image.new("RGB", (512, 512), (128, 128, 128))
                        out_pil = None
                        for _ in range(g_steps + 2):
                            out_pil = gen_w.img2img(pil_in, prompt=g_prompt)
                        buf = io.BytesIO()
                        out_pil.save(buf, format="JPEG", quality=90)
                        print(json.dumps({"single_gen": {
                            "status": "success",
                            "image_ia": "data:image/jpeg;base64," + _b64.b64encode(buf.getvalue()).decode("utf-8"),
                        }}), flush=True)
                    except Exception as ex:
                        print(json.dumps({"single_gen": {"status": "error", "error": str(ex)}}), flush=True)
                    finally:
                        # Restaurar os parâmetros correntes do ambiente virtual
                        _apply_sd_params(gen_w, guidance_scale=cfg_scale,
                                         t_index_list=map_denoising_to_t_index(denoising_strength, num_inference_steps),
                                         seed=seed_val)

        # A ativação move o denoising continuamente, não só quando se mexe no
        # slider. Só se pede novo update quando o valor se afastou o suficiente
        # para se notar: reaplicar a cada frame recalcularia o t_index_list para
        # nada, e cada aplicação toca no scheduler do pipeline.
        if wrapper and exhibition_state["streamdiffusionEnabled"]:
            alvo_den = denoising_por_ativacao(smoothed.get("aro", 0.5), denoising_strength)
            if abs(alvo_den - ultimo_denoising_aplicado[0]) >= 0.03:
                ultimo_denoising_aplicado[0] = alvo_den
                pending_sd["t_index"] = True

        # Aplicar os parâmetros SD coalescidos (último valor de cada slider, 1 update por ciclo)
        if pending_sd and wrapper:
            sd_kwargs = {}
            if pending_sd.get("cfg"):
                sd_kwargs["guidance_scale"] = cfg_scale
            if pending_sd.get("seed"):
                sd_kwargs["seed"] = seed_val
            if pending_sd.get("t_index"):
                # A ativação modula o denoising à volta do valor do painel.
                sd_kwargs["t_index_list"] = map_denoising_to_t_index(
                    denoising_por_ativacao(smoothed.get("aro", 0.5), denoising_strength),
                    num_inference_steps)
            _apply_sd_params(wrapper, **sd_kwargs)

        if not running:
            break

        # Capturar frame do telemóvel, webcam ou simular
        frame = None
        if phone_client and not use_webcam and not use_simulation:
            if not phone_client.alive:
                # Antes isto era um `break`: perder a ligação ao telemóvel
                # **matava o motor inteiro**. A partir daí nenhum comando era
                # recebido — incluindo o `SET_CAMERA_SOURCE pc:0` — e a câmara do
                # PC ficava aparentemente irrecuperável até reiniciar a app. Era
                # exatamente o que se via: uma passagem pelo telemóvel e a
                # câmara do PC "deixava de ser reconhecida".
                print("[AVISO] Ligação ao telemóvel perdida. A voltar à câmara do PC.",
                      file=sys.stderr)
                try:
                    phone_client.stop()
                except Exception:
                    pass
                phone_client = None
                cap_webcam = abrir_webcam(cam_index)
                use_webcam = cap_webcam is not None
                use_simulation = not use_webcam
                falhas_webcam = 0
                camera_estado.update(
                    fonte=f"pc:{cam_index}" if use_webcam else "simulacao",
                    erro="ligação ao telemóvel perdida")
                continue
            frame = phone_client.last_frame
            if frame is None:
                # Não esperar para sempre. Sem isto, um telemóvel que liga e não
                # espelha (ecrã bloqueado, autorização por aceitar) deixava o
                # motor sem imagem **e sem telemetria**: a interface ficava com a
                # última imagem da webcam congelada e nada dizia porquê. Era o
                # que se via — a imagem do telemóvel nunca entrava no lugar da
                # câmara e a partir dali não havia volta.
                agora_tele = time.time()
                if tele_sem_imagem_desde is None:
                    tele_sem_imagem_desde = agora_tele
                elif agora_tele - tele_sem_imagem_desde >= TELEFONE_SEM_IMAGEM_S:
                    print("[AVISO] O telemóvel ligou mas não entregou imagem. "
                          "A voltar à câmara do PC.", file=sys.stderr)
                    try:
                        phone_client.stop()
                    except Exception:
                        pass
                    phone_client = None
                    tele_sem_imagem_desde = None
                    cap_webcam = abrir_webcam(cam_index)
                    use_webcam = cap_webcam is not None
                    use_simulation = not use_webcam
                    falhas_webcam = 0
                    camera_estado.update(
                        fonte=f"pc:{cam_index}" if use_webcam else "simulacao",
                        erro="o telemóvel ligou mas não entregou imagem")
                    continue
                time.sleep(0.05)
                continue
            tele_sem_imagem_desde = None
        elif use_webcam and cap_webcam:
            try:
                ret, frame = cap_webcam.read()
                if not ret or frame is None:
                    # Uma câmara que abre e não entrega (ocupada por outra
                    # aplicação, ou desligada a meio) punha o laço em `continue`
                    # eterno: sem imagem, sem telemetria e sem uma única pista.
                    falhas_webcam += 1
                    if falhas_webcam >= 60:
                        print("[AVISO] A webcam deixou de entregar imagem. A reabrir.",
                              file=sys.stderr)
                        cap_webcam.release()
                        cap_webcam = abrir_webcam(cam_index)
                        use_webcam = cap_webcam is not None
                        use_simulation = not use_webcam
                        falhas_webcam = 0
                        camera_estado.update(
                            fonte=f"pc:{cam_index}" if use_webcam else "simulacao",
                            erro=None if use_webcam else "a webcam deixou de entregar imagem")
                    time.sleep(0.05)
                    continue
                falhas_webcam = 0
                # Espelho horizontal, ligado por omissão: a webcam entrega a cena
                # como a vê e não como um espelho. Deixa de ser o certo quando a
                # câmara filma o público de frente, daí ser comandável.
                if camera_mirror["on"]:
                    frame = cv2.flip(frame, 1)
            except Exception:
                time.sleep(0.05)
                continue
        else:
            # Modo de simulação total
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            color_pulse = int(127 + 127 * math.sin(time.time() * 2))
            cv2.rectangle(frame, (40, 40), (600, 440), (color_pulse, 63, 226), -1)
            cv2.putText(frame, "SIMULACAO ACTIVA", (160, 240), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
            cv2.putText(frame, f"BPM: {int(smoothed['bpm'])}", (240, 280), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 229, 255), 2)
            time.sleep(0.033) # Limitar FPS da simulação (~30 FPS)

            # Injetar telemetria simulada reativa (eixos dimensionais de Russell)
            bpm_base = 72 + 6 * math.sin(time.time() * 0.1)
            bpm_noise = np.random.normal(0, 0.5)
            smoothed["bpm"] = int(np.clip(bpm_base + bpm_noise, 60, 100))
            smoothed["val"] = 0.3 + 0.45 * math.sin(time.time() * 0.05)
            smoothed["aro"] = 0.5 + 0.35 * math.cos(time.time() * 0.08)
            smoothed["sym"] = 0.88 + 0.08 * math.sin(time.time() * 0.2)
            smoothed["positivo"] = max(0.0, smoothed["val"])
            smoothed["negativo"] = max(0.0, -smoothed["val"])
            smoothed["ativado"] = clamp(smoothed["aro"])
            smoothed["nao_ativado"] = clamp(1.0 - smoothed["aro"])
            smoothed["iris"] = 0.11 + 0.01 * math.sin(time.time() * 0.3)

        # Redimensionamento — preservar a orientação/aspeto (o código anterior forçava
        # paisagem→retrato (480,640), distorcendo e degradando a webcam 640x480)
        if frame.shape[1] > frame.shape[0]:
            frame = cv2.resize(frame, (640, 480))
        else:
            frame = cv2.resize(frame, (480, 800))

        # Cópia crua ANTES dos overlays — usada no layout lado-a-lado (feed original)
        frame_raw = frame.copy()
        last_capture["raw"] = frame_raw

        # FPS
        frame_count += 1
        now = time.time()
        if now - fps_time >= 1.0:
            current_fps = frame_count
            frame_count = 0
            fps_time = now

        # MediaPipe FaceMesh
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # Saudação: enquanto ninguém acenar, a peça fica à espera. A biometria
        # continua a correr por trás — quando o aceno chegar, o rPPG já aqueceu.
        if exhibition_state["aguardaSaudacao"]:
            if detector_aceno.atualizar(pulso_x(rgb, _saudacao_hands), time.time()):
                exhibition_state["aguardaSaudacao"] = False
                largar_hands(_saudacao_hands)
                synth_active = synth_apos_saudacao[0]
                # A sessão daquela pessoa começa aqui: o repouso não pode ter
                # sido medido na sala vazia, nem o quadrante herdado.
                _ativacao["bpm"].limpar()
                _ativacao["mov"].limpar()
                redefinir_piscar()
                redefinir_quadrante()
                print("[Sensus AI] Aceno reconhecido — ambiente a começar.", file=sys.stderr)
            elif _saudacao_hands["falhou"]:
                # Sem modelo de mãos não há saudação possível. Arrancar à mesma
                # é melhor do que prender o visitante num ecrã que nunca passa.
                exhibition_state["aguardaSaudacao"] = False
                synth_active = synth_apos_saudacao[0]
                print("[Sensus AI] Saudação ignorada (sem deteção de mãos).", file=sys.stderr)

        room_data = update_room(frame_raw, rgb)
        # Onde não há biometria facial (Air Painting, Fluid AI), saltar a malha de
        # rosto liberta ~23 ms/frame (medido) para o que o ambiente realmente usa.
        precisa_rosto = exhibition_state["faceTrackingEnabled"] and not exhibition_state["airPaintingEnabled"]
        results = face_mesh.process(rgb) if precisa_rosto else None
        frame_data = {}

        if results is not None and results.multi_face_landmarks and len(results.multi_face_landmarks) > 0:
            landmarks_raw = results.multi_face_landmarks[0].landmark
            h_img, w_img = frame.shape[:2]
            lms = [(l.x, l.y) for l in landmarks_raw]

            # Face width
            fw = np.hypot(lms[LEFT_EYE_OUTER][0] - lms[RIGHT_EYE_OUTER][0], lms[LEFT_EYE_OUTER][1] - lms[RIGHT_EYE_OUTER][1])
            if fw < 0.001: fw = 0.001

            # Métricas Cruas
            raw_be  = ((lms[LEFT_EYEBROW_INNER][1] + lms[RIGHT_EYEBROW_INNER][1]) / 2 - lms[NOSE_BRIDGE][1]) / fw
            raw_obe = ((lms[LEFT_EYEBROW_OUTER][1] + lms[RIGHT_EYEBROW_OUTER][1]) / 2 - (lms[LEFT_EYE_OUTER][1] + lms[RIGHT_EYE_OUTER][1]) / 2) / fw
            raw_bs  = abs(lms[LEFT_EYEBROW_INNER][0] - lms[RIGHT_EYEBROW_INNER][0]) / fw
            raw_mo  = abs(lms[MOUTH_TOP_LIP][1] - lms[MOUTH_BOTTOM_LIP][1]) / fw
            raw_mw  = abs(lms[MOUTH_LEFT][0] - lms[MOUTH_RIGHT][0]) / fw
            mc_y    = (lms[MOUTH_TOP_LIP][1] + lms[MOUTH_BOTTOM_LIP][1]) / 2
            mc_cy   = (lms[MOUTH_LEFT][1] + lms[MOUTH_RIGHT][1]) / 2
            raw_mt  = (mc_y - mc_cy) / fw
            raw_ea  = (abs(lms[159][1] - lms[145][1]) + abs(lms[386][1] - lms[374][1])) / (2 * fw)
            raw_ch  = ((lms[LEFT_CHEEK_TOP][1] + lms[RIGHT_CHEEK_TOP][1]) / 2 - lms[NOSE_BRIDGE][1]) / fw
            raw_nw  = abs(lms[NOSE_SIDE_L][0] - lms[NOSE_SIDE_R][0]) / fw
            raw_lt  = abs(lms[UPPER_LIP][1] - lms[LOWER_LIP][1]) / fw

            # Calibração — só frames de frente, fechada pela mediana. Ver
            # `frame_calibravel` / `fechar_calibracao`.
            if calibrating:
                if calib_inicio is None:
                    calib_inicio = time.time()
                if frame_calibravel(compute_head_pose(lms, w_img, h_img)):
                    calib_buffer.append({
                        "browSqueeze": raw_bs, "browElevation": raw_be,
                        "outerBrowElevation": raw_obe, "mouthWidth": raw_mw,
                        "mouthOpen": raw_mo, "mouthTilt": raw_mt,
                        "eyelidAperture": raw_ea, "cheekHeight": raw_ch,
                        "noseWidth": raw_nw, "lipThickness": raw_lt,
                        "chinHeight": abs(lms[CHIN][1] - lms[MOUTH_BOTTOM_LIP][1]) / fw,
                        "openEAR": (compute_ear(lms, L_EY) + compute_ear(lms, R_EY)) / 2,
                    })
                remaining = CALIBRATION_FRAMES - len(calib_buffer)
                expirou = time.time() - calib_inicio >= CALIB_TIMEOUT_S
                if remaining <= 0 or expirou:
                    calibrating = False
                    if fechar_calibracao(calib_buffer, baselines):
                        print(f"[Sensus AI] Calibração concluída — {len(calib_buffer)} frames de frente"
                              f"{' (por tempo esgotado)' if expirou else ''}.", file=sys.stderr)
                    else:
                        print("[Sensus AI] Calibração sem nenhum frame de frente — linha de base por "
                              "defeito. Olhar para a câmara e calibrar outra vez.", file=sys.stderr)
                else:
                    print(json.dumps({"status": "calibrating", "remaining": remaining}), flush=True)
                    time.sleep(0.03)
                    continue

            # Action Units
            pose_est = compute_head_pose(lms, w_img, h_img)
            pitch_penalty = max(0, (-pose_est["pitch"] - 25) / 40) * 0.35 if pose_est["pitch"] < -25 else 0

            au1  = clamp((baselines["browElevation"] - raw_be) * 6)
            au2  = clamp((baselines["outerBrowElevation"] - raw_obe) * 5.5)
            au4  = clamp((baselines["browSqueeze"] - raw_bs) * 6.5)
            au5  = clamp((raw_ea - baselines["eyelidAperture"]) * 12)
            au6  = clamp((baselines["cheekHeight"] - raw_ch) * 15)
            au9  = clamp((baselines["noseWidth"] - raw_nw) * 10)
            au12 = clamp(clamp((raw_mw - baselines["mouthWidth"]) * 4.5 + (raw_mt - baselines["mouthTilt"]) * 5) - pitch_penalty)
            au15 = clamp((baselines["mouthTilt"] - raw_mt) * 6.5)
            au17 = clamp((raw_lt - baselines["lipThickness"]) * 8)
            au20 = clamp((raw_mw - baselines["mouthWidth"]) * 3)
            au23 = clamp((baselines["lipThickness"] - raw_lt) * 10)
            au25 = clamp((raw_mo - baselines["mouthOpen"]) * 4)
            au26 = clamp((raw_mo - baselines["mouthOpen"]) * 6)

            valence = float(np.clip(au12 - (au4 * 0.45 + au15 * 0.85), -1, 1))
            # Ativação: cardíaco + movimento + rosto — ver `calcular_ativacao`.
            # O `d_au5` deixou de entrar: era um bónus fixo de 0,2 que dependia
            # de uma derivada ruidosa e, no log real, nunca chegou para nada.
            arousal, arousal_comp = calcular_ativacao(
                bpm_suavizado or 0,
                room_state["energy"],
                au5,
                au26,
                taxa_piscar=taxa_de_piscar() if active_sensors.get("blink", True) else None,
                usa_movimento=active_sensors.get("flow", True),
            )

            # Mapeamento dimensional de Russell (sem emoções discretas)
            dim = {
                "positivo":    clamp(valence),
                "negativo":    clamp(-valence),
                "ativado":     clamp(arousal),
                "nao_ativado": clamp(1.0 - arousal),
            }

            # Head Pose (mesmo frame/landmarks — reutiliza o resultado de cima)
            pose = pose_est

            # EAR + Blinks
            if active_sensors.get("blink", True):
                ear_l = compute_ear(lms, L_EY)
                ear_r = compute_ear(lms, R_EY)
                avg_ear = (ear_l + ear_r) / 2
                blink_threshold = (baselines["openEAR"] or 0.28) * 0.65
                if avg_ear < blink_threshold and not blink_cooldown:
                    blink_count += 1
                    registar_piscar()      # alimenta o eixo de ativação
                    blink_cooldown = True
                    blink_cooldown_end = time.time() + 0.3
                if blink_cooldown and time.time() >= blink_cooldown_end:
                    blink_cooldown = False
            else:
                ear_l = 0.3
                ear_r = 0.3
                avg_ear = 0.3

            # Simetria
            if active_sensors.get("symmetry", True):
                sym = compute_symmetry(lms)
            else:
                sym = 1.0

            # Distancia estimada camara-rosto (semelhanca de triangulos).
            # Estimativa, nao medicao — ver notas em estimar_distancia_cm.
            dist_cm = estimar_distancia_cm(lms, w_img)
            if dist_cm is not None:
                smoothed["dist_cm"] = float(dist_cm)
            if pending_distance_calib["cm"] is not None:
                if calibrar_distancia(lms, w_img, pending_distance_calib["cm"]):
                    print(f"[Sensus AI] Distancia calibrada: focal = "
                          f"{distance_calib['focal_px']:.1f} px", file=sys.stderr)
                else:
                    print("[Sensus AI] Calibracao de distancia falhou (rosto nao detetado).",
                          file=sys.stderr)
                pending_distance_calib["cm"] = None

            # Rastreio do Olhar e Fixação
            gaze_x = 0.0
            gaze_y = 0.0
            if active_sensors.get("gaze", True):
                try:
                    gaze_x, gaze_y = compute_gaze(lms)
                    if gaze_x >= 0 and gaze_y >= 0:
                        quad = 0
                    elif gaze_x < 0 and gaze_y >= 0:
                        quad = 1
                    elif gaze_x < 0 and gaze_y < 0:
                        quad = 2
                    else:
                        quad = 3

                    now_t = time.time()
                    if quad == last_quadrant:
                        fixation_duration = (now_t - fixation_start_time) * 1000.0
                    else:
                        last_quadrant = quad
                        fixation_start_time = now_t
                        fixation_duration = 0.0
                except Exception as gaze_ex:
                    print(f"[ERRO GAZE] {gaze_ex}", file=sys.stderr)
            else:
                last_quadrant = -1
                fixation_duration = 0.0

            # rPPG
            face_landmarks_px = [(int(l.x * w_img), int(l.y * h_img)) for l in landmarks_raw]
            x1, y1, x2, y2 = 0, 0, 0, 0
            rppg_progress = 0
            if active_sensors.get("rppg", True):
                xs = [p[0] for p in face_landmarks_px]
                ys = [p[1] for p in face_landmarks_px]
                x1, y1 = max(0, min(xs)), max(0, min(ys))
                x2, y2 = min(w_img, max(xs)), min(h_img, max(ys))
                roi_w = x2 - x1
                roi_h = y2 - y1

                if roi_w > 10 and roi_h > 10:
                    margin_x = int(roi_w * 0.18)
                    margin_y = int(roi_h * 0.15)
                    roi_color = frame[y1+margin_y:y2-margin_y, x1+margin_x:x2-margin_x]
                    if roi_color.shape[0] > 0 and roi_color.shape[1] > 0:
                        roi_resized = cv2.resize(roi_color, (64, 64))
                        roi_buffer.append(roi_resized)

                fs = float(current_fps) if current_fps > 5 else 30.0
                required_frames = int(fs * 4)
                if (RPPG_AVAILABLE and len(roi_buffer) >= required_frames
                        and (now - ultimo_rppg) >= RPPG_INTERVALO_S):
                    ultimo_rppg = now
                    try:
                        buffer_slice = list(roi_buffer)[-required_frames:]
                        video_data = np.array(buffer_slice, dtype=np.float32) / 255.0
                        bpm_bruto = calcular_bpm(POS_WANG(video_data, fs), fs)
                        if bpm_bruto:
                            if bpm_suavizado is not None and abs(bpm_bruto - bpm_suavizado) > 25:
                                pass
                            else:
                                historico_bpm.append(bpm_bruto)
                            if len(historico_bpm) > 0:
                                bpm_suavizado = int(np.mean(historico_bpm))
                    except Exception:
                        pass
                rppg_progress = min(100, int((len(roi_buffer) / required_frames) * 100)) if required_frames > 0 else 0
            else:
                roi_buffer.clear()
                bpm_suavizado = 0

            # Overlay roxo e ciano
            if active_sensors.get("rppg", True) and x2 > x1 and y2 > y1:
                cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 103, 124), 1)
            for idx in [LEFT_EYE_OUTER, RIGHT_EYE_OUTER, LEFT_EYEBROW_INNER, RIGHT_EYEBROW_INNER, MOUTH_LEFT, MOUTH_RIGHT, NOSE_TIP]:
                pt = face_landmarks_px[idx]
                cv2.circle(frame, pt, 2, (238, 211, 34), -1)

            # Íris tracking nativo (raio geométrico normalizado)
            iris_val = compute_iris_radius(lms) if active_sensors.get("gaze", True) else 0.0

            # Smoothing — eixos dimensionais de Russell
            raw = {
                "bpm": bpm_suavizado or 0, "val": valence, "aro": arousal,
                "positivo": dim["positivo"], "negativo": dim["negativo"],
                "ativado": dim["ativado"], "nao_ativado": dim["nao_ativado"],
                "AU1": au1, "AU2": au2, "AU4": au4, "AU5": au5, "AU6": au6, "AU9": au9,
                "AU12": au12, "AU15": au15, "AU17": au17, "AU20": au20,
                "AU23": au23, "AU25": au25, "AU26": au26,
                "pitch": pose["pitch"], "yaw": pose["yaw"], "roll": pose["roll"],
                "ear_l": ear_l, "ear_r": ear_r, "sym": sym, "iris": iris_val,
            }

            for key in smoothed:
                if key not in raw:
                    continue  # ex.: dist_cm — vem de estimar_distancia_cm, não de `raw`
                if key == "bpm":
                    smoothed[key] = raw[key]
                else:
                    smoothed[key] = alpha * raw[key] + (1 - alpha) * smoothed[key]

            dim_keys = ["positivo", "negativo", "ativado", "nao_ativado"]
            dominant = max(dim_keys, key=lambda k: smoothed[k])
            # Uma vez por frame: `quadrante_russell` tem estado (histerese e
            # permanência mínima) e chamá-lo duas vezes por frame fazia a mesma
            # medição contar a dobrar para o relógio da permanência.
            quadrante_atual = quadrante_russell(smoothed)

            # Output Telemetria
            frame_data = {
                "face":  True,
                "bpm":   int(smoothed["bpm"]),
                "rppg":  rppg_progress,
                "val":   round(smoothed["val"], 4),
                "aro":   round(smoothed["aro"], 4),
                "dom":   dominant,
                "russell": {k: round(smoothed[k], 4) for k in dim_keys},
                "emo": {k: round(smoothed[k], 4) for k in dim_keys},
                # De onde vem a ativação, componente a componente. `null` = o
                # sinal ainda não tem história ou está parado demais para contar.
                # Sem isto, um eixo que não mexe é indistinguível de um eixo
                # avariado — que foi exatamente o que aconteceu até aqui.
                "aro_comp": {k: (round(v, 3) if v is not None else None)
                             for k, v in arousal_comp.items()},
                "quadrante": quadrante_atual,
                "iris_radius": round(smoothed["iris"], 5),
                # Estimativa por semelhanca de triangulos, com largura facial
                # assumida. dist_calibrada indica se a focal foi medida nesta
                # camara ou se vem do FOV suposto — a UI deve distinguir.
                "dist_cm": dist_cm,
                "dist_calibrada": distance_calib["focal_px"] is not None,
                "dist_fonte": distance_calib["fonte"],
                "canvas": voice_thread.canvas_hint,
                "au": {
                    "1": round(smoothed["AU1"], 4),  "2": round(smoothed["AU2"], 4),
                    "4": round(smoothed["AU4"], 4),  "5": round(smoothed["AU5"], 4),
                    "6": round(smoothed["AU6"], 4),  "9": round(smoothed["AU9"], 4),
                    "12": round(smoothed["AU12"], 4), "15": round(smoothed["AU15"], 4),
                    "17": round(smoothed["AU17"], 4), "20": round(smoothed["AU20"], 4),
                    "23": round(smoothed["AU23"], 4), "25": round(smoothed["AU25"], 4),
                    "26": round(smoothed["AU26"], 4),
                },
                "pose": {
                    "p": round(smoothed["pitch"], 2),
                    "y": round(smoothed["yaw"], 2),
                    "r": round(smoothed["roll"], 2),
                },
                "ear":    [round(smoothed["ear_l"], 4), round(smoothed["ear_r"], 4)],
                # A fonte que o motor está mesmo a usar, e não a que foi pedida.
                "camera": dict(camera_estado),
                "blinks": blink_count,
                # Taxa, não só a contagem: é ela que entra no eixo de ativação, e
                # sem ela não se distingue "pestanejou 40 vezes na sessão toda" de
                # "está a pestanejar 40 vezes por minuto".
                "blink_rate": taxa_de_piscar(),
                "sym":    round(smoothed["sym"], 4),
                "gaze":   [round(gaze_x, 4), round(gaze_y, 4)],
                "fixation": round(fixation_duration, 1),
                "fps":    current_fps,
            }

            # Overlay descritivo (AUs, pose, ocular, vitais) sobre o feed medido
            if overlay_state["mode"] != "depth":
                frame = draw_face_markers(frame, frame_data, face_landmarks_px, active_sensors)
        else:
            # Sem rosto detetado — telemetria dimensional neutra
            dominant = "nao_ativado"
            dim_keys = ["positivo", "negativo", "ativado", "nao_ativado"]
            frame_data = {
                "bpm": int(smoothed["bpm"]), "rppg": min(100, int((len(roi_buffer) / (int(current_fps * 4) if current_fps > 5 else 120)) * 100)),
                "val": round(smoothed["val"], 4), "aro": round(smoothed["aro"], 4),
                "dom": "—",
                "russell": {k: round(smoothed.get(k, 0.0), 4) for k in dim_keys},
                "emo": {k: round(smoothed.get(k, 0.0), 4) for k in dim_keys},
                # Mantém o último quadrante em vez de o largar: perder o rosto
                # por um instante não é razão para trocar de prompt e dar um
                # salto na imagem gerada.
                "quadrante": _quadrante_estado["atual"] or "",
                "iris_radius": round(smoothed.get("iris", 0.0), 5),
                "canvas": voice_thread.canvas_hint,
                "au": {str(i): 0 for i in [1,2,4,5,6,9,12,15,17,20,23,25,26]},
                "pose": {"p": 0, "y": 0, "r": 0}, "ear": [0.3, 0.3],
                "camera": dict(camera_estado),
                "blinks": blink_count, "sym": 1.0,
                "gaze": [0.0, 0.0], "fixation": 0.0,
                "fps": current_fps, "face": False,
            }

        # Modo profundidade: o feed de parâmetros mostra o depth map (não depende
        # de rosto detetado). Enquanto carrega/erro, mantém-se a câmara simples.
        # A exposição ativa (exhibition_state["depthMapEnabled"]) também força o
        # cálculo do mapa de profundidade, independente do overlay do feed de
        # parâmetros — é o que alimenta a Depth Explorer (exp1) no frontend.
        # Cenario com efeito: calcula a profundidade da imagem fixa uma unica vez,
        # assim que o modelo estiver pronto. E uma inferencia so, nao por frame.
        if bg_still["estado"] == "pendente" and bg_still["pedido_b64"]:
            depth_estimator.ensure_loading()
            if depth_estimator.status == "ready":
                bg_still["estado"] = "a_calcular"
                try:
                    crua = base64.b64decode(bg_still["pedido_b64"])
                    img = cv2.imdecode(np.frombuffer(crua, np.uint8), cv2.IMREAD_COLOR)
                    if img is None:
                        raise ValueError("imagem ilegivel")
                    mapa = depth_estimator.render_still(img)
                    if mapa is None:
                        raise RuntimeError("estimador indisponivel")
                    ok_enc, buf = cv2.imencode(".jpg", mapa, [cv2.IMWRITE_JPEG_QUALITY, 85])
                    if not ok_enc:
                        raise RuntimeError("falha a codificar o mapa")
                    bg_still["depth_b64"] = "data:image/jpeg;base64," + \
                        base64.b64encode(buf).decode("utf-8")
                    bg_still["estado"] = "pronto"
                    print("[BG] Profundidade da imagem de cenario calculada.", file=sys.stderr)
                except Exception as ex:
                    bg_still["estado"] = "erro"
                    print(f"[BG ERRO] {ex}", file=sys.stderr)
                finally:
                    bg_still["pedido_b64"] = None
            elif depth_estimator.status == "erro":
                bg_still["estado"] = "erro"

        # Calibracao por tabuleiro, quando pedida. Nao depende de rosto detetado,
        # por isso corre aqui e nao no ramo dos landmarks.
        if chessboard_calib["ativa"]:
            try:
                processar_frame_tabuleiro(frame_raw)
            except Exception as ex:
                chessboard_calib["estado"] = "erro"
                chessboard_calib["mensagem"] = str(ex)[:80]
                chessboard_calib["ativa"] = False

        # O frame externo, quando existe, ganha à câmara como entrada do img2img.
        # É o que permite ao Fluid AI gerar sobre a simulação em vez do vídeo.
        sd_source = sd_input_externo["frame"] if sd_input_externo["frame"] is not None else frame_raw
        depth_pure = None
        need_depth = overlay_state["mode"] == "depth" or exhibition_state["depthMapEnabled"]
        if need_depth:
            depth_estimator.ensure_loading()
            depth_frame = depth_estimator.render(frame_raw)
            if overlay_state["mode"] == "depth" and depth_frame is not None:
                frame = depth_frame
            if depth_estimator.status == "ready":
                depth_pure = depth_estimator.get_last_map()
                if depth_pure is not None and overlay_state["mode"] == "depth":
                    sd_source = depth_pure
        # Air Painting: corre depois do mapa de profundidade, porque é dele que
        # sai o gatilho do eixo Z. O resultado substitui o feed da câmara, para
        # que painel de controlo e janela de projeção mostrem a mesma tela sem
        # a telemetria ter de transportar a imagem duas vezes.
        if exhibition_state["airPaintingEnabled"]:
            frame = air_painter.processar(frame_raw, rgb, depth_pure)
            frame_data["paint"] = dict(air_painter.info)
            frame_data["paint"]["limiar"] = air_painter.limiar
            frame_data["paint"]["estado"] = air_painter.status
            frame_data["paint"]["suavizacao"] = round(air_painter.suavizacao, 2)
            frame_data["paint"]["borracha"] = air_painter.borracha
            frame_data["paint"]["espessura_gesto"] = air_painter.espessura_por_gesto
            frame_data["paint"]["pode_anular"] = len(air_painter._historico) > 0
            frame_data["paint"]["caneta"] = air_painter.caneta
            frame_data["paint"]["camada"] = air_painter.camada_ativa
            frame_data["paint"]["camadas"] = [
                {"opacidade": round(c["opacidade"], 2), "mistura": c["mistura"], "visivel": c["visivel"]}
                for c in air_painter.camadas
            ]

        # Fluid AI: o campo de movimento filmado é o que agita o fluido, por isso
        # viaja para o frontend como imagem. Vai a 64×64 e em PNG — pequeno o
        # suficiente (~5 KB) e sem os artefactos que o JPEG introduziria num
        # campo de velocidades, onde apareceriam como turbulência inventada.
        if exhibition_state["fluidEnabled"]:
            campo = room_state.get("flow_field")
            if campo is not None:
                # ±FLUXO_MAX px/frame mapeados para 0-255; 128 = parado.
                fx = np.clip(campo[..., 0] / FLUXO_MAX, -1.0, 1.0)
                fy = np.clip(campo[..., 1] / FLUXO_MAX, -1.0, 1.0)
                rgb_campo = np.zeros((campo.shape[0], campo.shape[1], 3), dtype=np.uint8)
                rgb_campo[..., 2] = ((fx * 0.5 + 0.5) * 255).astype(np.uint8)   # R
                rgb_campo[..., 1] = ((fy * 0.5 + 0.5) * 255).astype(np.uint8)   # G
                pequeno = cv2.resize(rgb_campo, (64, 64), interpolation=cv2.INTER_AREA)
                ok_f, buf_f = cv2.imencode('.png', pequeno)
                if ok_f:
                    frame_data["flow_field"] = ("data:image/png;base64,"
                                                + base64.b64encode(buf_f).decode('utf-8'))

        frame_data["overlay_mode"] = overlay_state["mode"]
        frame_data["depth_status"] = depth_estimator.status
        frame_data["bg_depth_status"] = bg_still["estado"]
        # O mapa so viaja quando acabou de ficar pronto; depois disso o frontend
        # ja o tem em cache e nao vale a pena repetir ~50 KB por frame.
        if bg_still["estado"] == "pronto" and bg_still["depth_b64"]:
            frame_data["bg_depth_map"] = bg_still["depth_b64"]
            bg_still["depth_b64"] = None
        frame_data["chess_calib"] = {
            "estado": chessboard_calib["estado"],
            "capturadas": len(chessboard_calib["imgpoints"]),
            "alvo": chessboard_calib["alvo"],
            "mensagem": chessboard_calib["mensagem"],
        }
        frame_data["room"] = room_data

        # Nota atual da camada de Melodia (consumida pela pauta em tempo real)
        frame_data["note"] = last_melody_note["name"]
        frame_data["note_id"] = last_melody_note["id"]

        # ── Avaliação do grafo de nodes (sistema de nodes do Ambiente Virtual) ──
        # Ver docs/superpowers/specs/2026-07-27-node-graph-sen-format-design.md e
        # docs/superpowers/specs/2026-07-27-td-node-catalog-expansion-design.md
        graph_context = {
            "bpm": smoothed.get("bpm", 0.0),
            "val": smoothed.get("val", 0.0),
            "aro": smoothed.get("aro", 0.0),
            "iris_radius": smoothed.get("iris", 0.0),
            "sym": smoothed.get("sym", 0.0),
            # Estimativa, com o erro documentado em estimar_distancia_cm. Serve
            # para controlo visual (ex. amplitude no Depth Map Tools), nao para
            # nada que se apresente como medida.
            "dist_cm": smoothed.get("dist_cm", 0.0),
            "blinks": float(blink_count),
            "russell.positivo": smoothed.get("positivo", 0.0),
            "russell.negativo": smoothed.get("negativo", 0.0),
            "russell.ativado": smoothed.get("ativado", 0.0),
            "russell.nao_ativado": smoothed.get("nao_ativado", 0.0),
            "time": time.monotonic() - _engine_start_time,
            "audio_bass": audio_spectrum_state["bass"],
            "audio_mid": audio_spectrum_state["mid"],
            "audio_treble": audio_spectrum_state["treble"],
            "camera_image": frame_raw,
            "depth_map_image": depth_pure,
            "generated_image": last_output_frame["value"],
        }
        try:
            graph_outputs, graph_error = node_graph.evaluate(active_graph, graph_context, graph_runtime_state)
        except Exception as ex:
            # O grafo NUNCA pode matar o loop principal — um bug interno do
            # node_graph vira só um erro reportado, não um crash do engine.
            graph_outputs, graph_error = None, str(ex)
        frame_data["graph_error"] = graph_error
        prompt_extra = ""
        pending_sd_output_image = None
        if graph_outputs is not None:
            if graph_outputs["sd_params"]:
                gp = graph_outputs["sd_params"]
                cfg_scale = gp["cfg"]
                denoising_strength = gp["denoising"]
                num_inference_steps = gp["steps"]
                seed_val = gp["seed"]
            for lc in graph_outputs["layer_control"]:
                if lc["layer"] in audio_layers:
                    audio_layers[lc["layer"]]["vol"] = lc["volume"]
                    audio_layers[lc["layer"]]["on"] = lc["on"]
            if graph_outputs["music_modifiers"]:
                mm = graph_outputs["music_modifiers"]
                user_music["scale"] = mm["scale"]
                user_music["bpm_mult"] = mm["bpmMult"]
                user_music["cutoff_mult"] = mm["cutoffMult"]
            if graph_outputs["prompt_fragments"]:
                prompt_extra = ", " + ", ".join(graph_outputs["prompt_fragments"])
            # image_output — cada TOP chain diz onde volta a entrar no pipeline.
            # Vários nodes podem visar o mesmo target: o último da lista vence
            # (mesma regra simples já usada no depth_viz).
            for io in graph_outputs["image_output"]:
                if io["image"] is None:
                    continue
                if io["target"] == "sd_input":
                    sd_source = io["image"]
                elif io["target"] == "depth_map":
                    depth_pure = io["image"]
                elif io["target"] == "sd_output":
                    pending_sd_output_image = io["image"]
            # Prioridade: node `depth_viz_output` no grafo (se algum) > sliders
            # manuais da Depth Map Tools (só relevantes quando a exposição usa
            # mapa de profundidade) > nada (Regulação Sensorial não usa isto).
            #
            # Exceção, para a Depth Map Tools: o grafo só ganha nas chaves que
            # recebe mesmo por ligação (`depth_viz_driven`). As outras ficam nos
            # sliders manuais — senão, pôr um único node no grafo congelava o
            # painel de controlo inteiro nos valores por omissão do node.
            # `technique` e `colorMode` não têm porta de entrada, por isso são
            # sempre do painel manual nesta exposição.
            if graph_outputs["depth_viz"] is not None:
                if exhibition_state["depthMapEnabled"]:
                    node_params = dict(manual_depth_params)
                    for key in graph_outputs["depth_viz_driven"]:
                        node_params[key] = graph_outputs["depth_viz"][key]
                else:
                    node_params = dict(graph_outputs["depth_viz"])
            elif exhibition_state["depthMapEnabled"]:
                node_params = dict(manual_depth_params)
            else:
                node_params = None
            # Câmara: o node `camera_3d` do grafo ganha; sem ele, valem os
            # controlos do painel (órbita, distância). Mesma regra dos sliders.
            if node_params is not None and not graph_outputs["camera_3d"]:
                node_params["camera"] = dict(manual_depth_camera)
            if graph_outputs["transform_3d"] or graph_outputs["camera_3d"] or graph_outputs["light_3d"]:
                node_params = node_params or {}
                if graph_outputs["transform_3d"]:
                    node_params["transform"] = graph_outputs["transform_3d"]
                if graph_outputs["camera_3d"]:
                    node_params["camera"] = graph_outputs["camera_3d"]
                if graph_outputs["light_3d"]:
                    node_params["light"] = graph_outputs["light_3d"]
            if node_params is not None:
                last_node_params["value"] = node_params
        frame_data["node_params"] = last_node_params["value"]

        # Mapa de profundidade final (possivelmente filtrado por um image_output
        # com target="depth_map") — codificado só agora, depois do grafo correr.
        if exhibition_state["depthMapEnabled"] and depth_pure is not None:
            # O mapa muda a ~10 Hz (ver `_infer_loop`) e o ciclo corre a mais do
            # dobro disso: codificá-lo e enviá-lo em todos os frames era repetir
            # um JPEG e uma string base64 de dezenas de KB por nada — a parcela
            # mais cara da telemetria, e inteiramente desperdiçada. Aqui só se
            # codifica quando o mapa é novo; nos outros frames a chave não vai no
            # JSON e a projeção usa a que já tinha (ver `useMapaProfundidade`).
            #
            # A condição do meio é para o caso de um `image_output` do grafo
            # filtrar o mapa: aí sai um array novo a cada frame e o carimbo do
            # estimador deixa de dizer alguma coisa sobre o que se vai enviar.
            carimbo = depth_estimator.get_last_map_t()
            if carimbo != ultimo_depth["t"] or depth_pure is not ultimo_depth["mapa"]:
                # Um canal em vez de três: um JPEG de luminância ocupa cerca de
                # um terço do de três canais. O shader lê a luma da textura, por
                # isso recebe exatamente o mesmo número.
                #
                # Pela luminância e não pelo canal 0: sem um `image_output` do
                # grafo pelo meio os três canais são cópias um do outro e dá no
                # mesmo, mas um filtro de cor no grafo torna-os diferentes, e aí
                # ficar com o azul mudava a imagem em silêncio.
                cinza = depth_pure if depth_pure.ndim == 2 else cv2.cvtColor(depth_pure, cv2.COLOR_BGR2GRAY)
                _, img_depth_enc = cv2.imencode('.jpg', cinza, [cv2.IMWRITE_JPEG_QUALITY, 85])
                ultimo_depth["t"] = carimbo
                ultimo_depth["mapa"] = depth_pure
                ultimo_depth["b64"] = "data:image/jpeg;base64," + base64.b64encode(img_depth_enc).decode('utf-8')
                frame_data["depth_map"] = ultimo_depth["b64"]

        # 2. Executar StreamDiffusion (Img2Img em tempo real)
        if wrapper is None and _sd_bg["wrapper"] is not None:
            wrapper = _sd_bg["wrapper"]
            # Sincronizar os parâmetros correntes da UI (comandos recebidos durante
            # o carregamento eram guardados nas variáveis mas nunca aplicados).
            _apply_sd_params(
                wrapper,
                guidance_scale=cfg_scale,
                t_index_list=map_denoising_to_t_index(denoising_strength, num_inference_steps),
                seed=seed_val,
            )
        # A geração corre numa thread própria (ver _sd_loop). Aqui só se entrega
        # o frame de entrada mais recente e se recolhe a última imagem pronta.
        #
        # Antes o img2img corria em linha e bloqueava o ciclo inteiro: captura,
        # biometria e telemetria ficavam à espera dele. Medido, custava ~50 ms por
        # frame, o que sozinho punha um tecto de 20 FPS em tudo o resto e fazia a
        # imagem gerada e a telemetria partilharem a mesma cadência lenta. Separadas,
        # cada uma corre ao seu ritmo.
        output_frame = None
        output_jpeg = None          # já codificado pela thread de geração
        if (exhibition_state["streamdiffusionEnabled"] and wrapper
                and not exhibition_state["aguardaSaudacao"]):
            # Crop para quadrado central e resize para 512x512.
            # Usa o frame CRU — os overlays biométricos desenhados em `frame`
            # contaminavam a geração (retângulo/pontos entravam no img2img).
            h_sd, w_sd = sd_source.shape[:2]
            min_dim = min(h_sd, w_sd)
            start_x = (w_sd - min_dim) // 2
            start_y = (h_sd - min_dim) // 2
            square_frame = sd_source[start_y:start_y + min_dim, start_x:start_x + min_dim]
            # Prompt do quadrante de Russell em que o estado se encontra, com
            # recurso à prompt única quando esse quadrante não foi preenchido.
            # O quadrante é o que já foi decidido acima, neste frame.
            base_prompt = prompts_quadrante.get(frame_data.get("quadrante", ""), "") or user_prompt
            prompt_final = f"{base_prompt}, pulsing energy, rhythm {smoothed['bpm'] or 70} bpm{prompt_extra}"
            with _sd_job["lock"]:
                # Slot único, o mais recente ganha: uma fila só acumularia atraso,
                # porque a geração é mais lenta do que a captura.
                _sd_job["entrada"] = cv2.resize(square_frame, (512, 512))
                _sd_job["prompt"] = prompt_final
                _sd_job["wrapper"] = wrapper
                output_frame = _sd_job["saida"]
                output_jpeg = _sd_job["saida_jpeg"]
            if pending_sd_output_image is not None:
                # Imagem vinda do grafo de nós, não da geração: essa ainda não
                # está codificada, e não passa pelo upscale.
                output_frame = pending_sd_output_image
                output_jpeg = None
            if output_frame is not None:
                last_output_frame["value"] = output_frame

        # 3. Base64 Encode e Output JSON — resolução nativa e qualidade alta:
        # os feeds passaram a ser o conteúdo principal do painel de controlo
        # (o downscale 320px/q50 anterior era a causa da pixelização).
        try:
            import base64
            # Volta a 85, igual ao feed cru: este frame deixou de ir supersampled
            # a 2× (o painel de valores passou para a interface), por isso já não
            # há píxeis a mais a compensar a compressão.
            _, img_encoded = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            frame_data["image"] = "data:image/jpeg;base64," + base64.b64encode(img_encoded).decode('utf-8')

            # Feed CRU (sem overlays)
            _, img_raw_enc = cv2.imencode('.jpg', frame_raw, [cv2.IMWRITE_JPEG_QUALITY, 85])
            frame_data["image_raw"] = "data:image/jpeg;base64," + base64.b64encode(img_raw_enc).decode('utf-8')

            # Foto da IA (output) — ecrã de projeção dedicado
            if output_jpeg is not None:
                frame_data["image_ia"] = output_jpeg
            elif output_frame is not None:
                _, img_encoded_ia = cv2.imencode('.jpg', output_frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
                frame_data["image_ia"] = "data:image/jpeg;base64," + base64.b64encode(img_encoded_ia).decode('utf-8')
        except Exception as e:
            print(f"[ENCODE ERRO] {e}", file=sys.stderr)

        frame_data["sd_status"] = "ready" if wrapper else _sd_bg["status"]
        if _sd_bg["erro"] and not wrapper:
            frame_data["sd_erro"] = _sd_bg["erro"]
        # Cadência da geração, agora independente da do ciclo principal.
        frame_data["sd_fps"] = round(_sd_job["fps"], 1)
        frame_data["music"] = dict(music_state)
        # Saudação: só vai na telemetria enquanto se espera. Ausente = a peça
        # está a correr, que é o caso na esmagadora maioria dos frames.
        if exhibition_state["aguardaSaudacao"]:
            frame_data["saudacao"] = {"ativa": True,
                                      "progresso": round(detector_aceno.progresso, 2)}
        print(json.dumps(frame_data), flush=True)
        # Cede o GIL para a thread de áudio (o som nunca pode parar) sem impor um
        # tecto ao frame-rate: a cadência real é dada pelo cap.read(), que bloqueia
        # à espera da câmara. O sleep de 20 ms que aqui estava custava 21 ms/frame
        # medidos e limitava o motor a 50 FPS mesmo sem fazer nada.
        time.sleep(0.001)

    # Cleanup
    face_mesh.close()
    if room_state["face_det"] is not None:
        room_state["face_det"].close()
    if room_state["pose_model"] is not None:
        room_state["pose_model"].close()
    print("[Sensus AI] Pipeline unificado encerrado.", file=sys.stderr)

if __name__ == "__main__":
    main()
