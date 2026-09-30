#!/usr/bin/env python3
"""Testes à linha de base das Action Units — `frame_calibravel` e `fechar_calibracao`.

Corre o **código real do motor**: as funções são extraídas do
`engine_sensus_unificado.py` por AST e executadas aqui, em vez de
reimplementadas. Importar o módulo inteiro não serve — arrancaria câmara,
áudio e StreamDiffusion.

    python test_calibracao_aus.py
"""

import ast
import os
import sys

import numpy as np

ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "engine_sensus_unificado.py")
ALVOS = {"clamp", "frame_calibravel", "fechar_calibracao", "CALIB_POSE_MAX", "CALIB_TIMEOUT_S"}


def carregar_do_motor():
    """Extrai as funções e constantes alvo do ficheiro do motor, sem o importar."""
    arvore = ast.parse(open(ENGINE, encoding="utf-8").read())
    nos = []
    for no in arvore.body:
        if isinstance(no, ast.FunctionDef) and no.name in ALVOS:
            nos.append(no)
        elif isinstance(no, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id in ALVOS for t in no.targets
        ):
            nos.append(no)
    ns = {"np": np}
    exec(compile(ast.Module(body=nos, type_ignores=[]), ENGINE, "exec"), ns)
    em_falta = ALVOS - ns.keys()
    assert not em_falta, f"não encontrado no motor: {em_falta}"
    return ns


M = carregar_do_motor()
frame_calibravel = M["frame_calibravel"]
fechar_calibracao = M["fechar_calibracao"]
clamp = M["clamp"]

# Métricas de uma cara em repouso, de frente. Só a abertura da pálpebra importa
# para estes testes; as outras chaves estão cá porque a calibração fixa todas.
REPOUSO = {"eyelidAperture": 0.090, "openEAR": 0.280, "mouthOpen": 0.020}
BASES = dict.fromkeys(REPOUSO, 0.0)


def au5(raw_ea, baselines):
    """AU5 tal como o motor a calcula: abertura da pálpebra acima da base."""
    return clamp((raw_ea - baselines["eyelidAperture"]) * 12)


def frame(pitch=0.0, yaw=0.0, roll=0.0, fechado=False):
    """Um frame de calibração. Pitch/yaw/roll encurtam a distância vertical
    medida na imagem por cos(ângulo) — é geometria de projeção, não expressão."""
    escala = np.cos(np.radians(pitch)) * np.cos(np.radians(yaw)) * np.cos(np.radians(roll))
    m = {k: v * escala for k, v in REPOUSO.items()}
    if fechado:  # pestanejo: as pálpebras encostam
        m["eyelidAperture"] = 0.004
        m["openEAR"] = 0.030
    return {"pitch": pitch, "yaw": yaw, "roll": roll}, m


def calibrar(frames, com_porta=True, mediana=True):
    """Corre a calibração sobre uma sequência de frames e devolve as bases."""
    buffer = [m for pose, m in frames if not com_porta or frame_calibravel(pose)]
    baselines = dict(BASES)
    if mediana:
        fechar_calibracao(buffer, baselines)
    elif buffer:  # comportamento antigo, para comparação: média de tudo
        for k in baselines:
            baselines[k] = sum(d[k] for d in buffer) / len(buffer)
    return baselines


def test_porta_de_pose():
    assert frame_calibravel({"pitch": 0, "yaw": 0, "roll": 0})
    assert frame_calibravel({"pitch": -11.9, "yaw": 14.9, "roll": -14.9})
    assert not frame_calibravel({"pitch": -30, "yaw": 0, "roll": 0}), "cabeça baixa entrou"
    assert not frame_calibravel({"pitch": 0, "yaw": 25, "roll": 0}), "cara de lado entrou"
    assert not frame_calibravel({"pitch": 0, "yaw": 0, "roll": 20}), "cabeça inclinada entrou"


def test_pestanejos_nao_encurtam_a_base():
    """Um pestanejo em cada 20 frames puxava a média; a mediana ignora-o."""
    frames = [frame(fechado=(i % 20 == 0)) for i in range(60)]
    med = calibrar(frames)
    media = calibrar(frames, mediana=False)
    assert abs(med["eyelidAperture"] - REPOUSO["eyelidAperture"]) < 1e-9
    assert media["eyelidAperture"] < REPOUSO["eyelidAperture"] * 0.96
    # E o limiar do pestanejo (openEAR × 0,65) deixa de descer com eles
    assert med["openEAR"] > media["openEAR"]


def test_cabeca_baixa_nao_arregala_os_olhos_a_sessao_inteira():
    """O defeito documentado: base apanhada a olhar para baixo, AU5 preso em cima.

    Arranque plausível — 40 frames a olhar para o teclado, 20 já a olhar para a
    câmara. O modelo aqui é **só** o encurtamento geométrico por cos(pitch), que
    é um limite inferior: ao vivo mediu-se um componente facial com mediana
    0,728, muito acima do que a projeção sozinha explica (a pálpebra também
    desce de facto quando se olha para baixo, e a estimativa da malha degrada-se
    fora de frente). Basta o limite inferior para o teste: o que se exige é que
    o enviesamento permanente desapareça, não que seja de tal tamanho.
    """
    frames = [frame(pitch=-35) for _ in range(40)] + [frame() for _ in range(20)]
    antes = calibrar(frames, com_porta=False, mediana=False)
    depois = calibrar(frames)
    assert au5(REPOUSO["eyelidAperture"], antes) > 0.10, "o caso de teste não reproduz o defeito"
    assert au5(REPOUSO["eyelidAperture"], depois) == 0.0
    assert depois["eyelidAperture"] == REPOUSO["eyelidAperture"]


def test_sem_frames_de_frente_fica_o_defeito():
    """Ninguém olhou para a câmara: nada é fixado e quem chama fica a saber."""
    baselines = {"eyelidAperture": 0.08}
    assert fechar_calibracao([], baselines) is False
    assert baselines["eyelidAperture"] == 0.08


def test_uma_metrica_em_falta_nao_rebenta():
    baselines = {"eyelidAperture": 0.08, "openEAR": 0.28}
    assert fechar_calibracao([{"eyelidAperture": 0.1}], baselines) is True
    assert baselines["eyelidAperture"] == 0.1
    assert baselines["openEAR"] == 0.28, "chave sem amostras devia ficar como estava"


def test_mediana_e_impar_e_par():
    baselines = {"x": 0.0}
    fechar_calibracao([{"x": 1.0}, {"x": 2.0}, {"x": 9.0}], baselines)
    assert baselines["x"] == 2.0
    fechar_calibracao([{"x": 1.0}, {"x": 2.0}, {"x": 4.0}, {"x": 9.0}], baselines)
    assert baselines["x"] == 3.0


if __name__ == "__main__":
    testes = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in testes:
        t()
        print(f"  ok  {t.__name__}")
    print(f"\n{len(testes)} testes a passar.")
    sys.exit(0)
