#!/usr/bin/env python3
"""Transcrição local por Whisper, como processo persistente.

Protocolo: uma linha de stdin = um caminho de ficheiro de áudio; uma linha de
stdout = a resposta em JSON. O processo fica vivo, por isso só a primeira
transcrição paga o carregamento do modelo.

Porque não vive dentro do `engine_sensus_unificado.py`: importar `cv2` e o
`mediapipe` custa 10,3 s (medido nesta máquina) e a transcrição não usa nem um
nem outro. Com este ficheiro à parte o arranque é de ~8 s e cada transcrição
seguinte demora ~1 s, contra ~17 s por ditado se fosse pelo motor.

Descodifica com PyAV, o que aceita o webm/opus do MediaRecorder tal como aceita
um .wav — e evita depender do ffmpeg de linha de comandos, que não vem no pacote.
"""
import json
import os
import sys

script_dir = os.path.dirname(os.path.abspath(__file__))
# Mesma cache do motor: os modelos viajam dentro do pacote, não em %USERPROFILE%.
os.environ.setdefault("HF_HOME", os.path.join(script_dir, "hf_cache"))

MODELO = os.environ.get("SENSUS_WHISPER_MODEL", "openai/whisper-small")
TAXA = 16000

_pipe = None


def _obter_pipe():
    global _pipe
    if _pipe is None:
        from transformers import pipeline
        import torch
        usa_gpu = torch.cuda.is_available()
        _pipe = pipeline(
            "automatic-speech-recognition",
            model=MODELO,
            device=0 if usa_gpu else -1,
            torch_dtype=torch.float16 if usa_gpu else torch.float32,
        )
        print(f"[STT] Whisper pronto ({MODELO}, {'GPU' if usa_gpu else 'CPU'}).",
              file=sys.stderr, flush=True)
    return _pipe


def ler_audio_16k(caminho):
    """Qualquer formato → PCM mono float32 a 16 kHz. None se não houver áudio."""
    import av
    import numpy as np
    blocos = []
    with av.open(caminho) as cont:
        if not cont.streams.audio:
            return None
        rs = av.AudioResampler(format="s16", layout="mono", rate=TAXA)
        for frame in cont.decode(cont.streams.audio[0]):
            for saida in rs.resample(frame):
                blocos.append(saida.to_ndarray().reshape(-1))
        for saida in rs.resample(None):     # drenar o buffer do resampler
            blocos.append(saida.to_ndarray().reshape(-1))
    if not blocos:
        return None
    return np.concatenate(blocos).astype(np.float32) / 32768.0


def transcrever(caminho):
    pcm = ler_audio_16k(caminho)
    # Menos de 0,2 s não é fala; poupa uma passagem inteira pelo modelo.
    if pcm is None or len(pcm) < TAXA // 5:
        return ""
    resultado = _obter_pipe()(
        {"raw": pcm, "sampling_rate": TAXA},
        generate_kwargs={"language": "portuguese", "task": "transcribe"},
    )
    return (resultado.get("text") or "").strip()


def main():
    print(json.dumps({"pronto": True}), flush=True)
    for linha in sys.stdin:
        caminho = linha.strip().lstrip("﻿")   # BOM se a stdin vier de um ficheiro UTF-8
        if not caminho or caminho == "QUIT":
            break
        try:
            print(json.dumps({"text": transcrever(caminho), "success": True}), flush=True)
        except Exception as ex:
            print(json.dumps({"text": "", "success": False, "error": str(ex)}), flush=True)


def _autoteste():
    """Verificação mínima do descodificador, sem modelo: gera um WAV de 1 s e
    confirma que volta como PCM de 16000 amostras."""
    import wave
    import tempfile
    import numpy as np
    caminho = os.path.join(tempfile.gettempdir(), "stt_autoteste.wav")
    with wave.open(caminho, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(TAXA)
        t = np.linspace(0, 1, TAXA, endpoint=False)
        wf.writeframes((np.sin(2 * np.pi * 440 * t) * 16000).astype(np.int16).tobytes())
    pcm = ler_audio_16k(caminho)
    os.remove(caminho)
    assert pcm is not None, "descodificação devolveu None"
    assert abs(len(pcm) - TAXA) < TAXA * 0.02, f"esperava ~{TAXA} amostras, vieram {len(pcm)}"
    assert pcm.dtype.name == "float32", f"dtype errado: {pcm.dtype}"
    assert 0.4 < float(abs(pcm).max()) < 0.6, f"amplitude fora do esperado: {abs(pcm).max()}"
    print("autoteste OK")


if __name__ == "__main__":
    if "--autoteste" in sys.argv:
        _autoteste()
    else:
        main()
