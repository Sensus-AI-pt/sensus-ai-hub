#!/usr/bin/env python3
"""Testes ao detetor de aceno que arranca a Regulação Sensorial.

Corre o **código real do motor**: o `DetectorDeAceno` é extraído do
`engine_sensus_unificado.py` por AST. A parte do MediaPipe fica de fora de
propósito — o que se testa aqui é a gramática do gesto, que é o que decide se
a peça arranca com quem acena e não com quem passa.

    python test_saudacao.py
"""

import ast
import os
import sys

import numpy as np

ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "engine_sensus_unificado.py")
ALVOS = {"clamp", "DetectorDeAceno"}
FPS = 20


def carregar_do_motor():
    arvore = ast.parse(open(ENGINE, encoding="utf-8").read())
    nos = [n for n in arvore.body
           if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in ALVOS]
    ns = {"np": np, "math": __import__("math")}
    exec(compile(ast.Module(body=nos, type_ignores=[]), ENGINE, "exec"), ns)
    em_falta = ALVOS - ns.keys()
    assert not em_falta, f"não encontrado no motor: {em_falta}"
    return ns


M = carregar_do_motor()
DetectorDeAceno = M["DetectorDeAceno"]


def alimentar(det, posicoes, t0=0.0):
    """Dá ao detetor uma sequência de posições x (None = sem mão), a `FPS`.

    Devolve o instante em que detetou, ou None.
    """
    for i, x in enumerate(posicoes):
        if det.atualizar(x, t0 + i / FPS):
            return t0 + i / FPS
    return None


def aceno(segundos=2.0, hz=2.0, amplitude=0.08, centro=0.5):
    """Uma mão a acenar: oscilação horizontal em torno de um centro."""
    return [centro + amplitude * np.sin(2 * np.pi * hz * (i / FPS))
            for i in range(int(segundos * FPS))]


def test_acenar_arranca_o_ambiente():
    det = DetectorDeAceno()
    quando = alimentar(det, aceno(segundos=3.0))
    assert quando is not None, "um aceno claro não foi detetado"
    assert quando <= 2.5, f"demorou {quando:.1f} s a reconhecer o aceno"


def test_mao_parada_nao_arranca():
    """Alguém de mão levantada mas quieta não está a acenar."""
    det = DetectorDeAceno()
    assert alimentar(det, [0.5] * (5 * FPS)) is None


def test_tremor_da_mao_nao_arranca():
    """Ruído de deteção não pode contar como oscilação."""
    rng = np.random.default_rng(11)
    det = DetectorDeAceno()
    ruido = [0.5 + float(rng.normal(0, 0.004)) for _ in range(5 * FPS)]
    assert alimentar(det, ruido) is None


def test_passar_a_mao_uma_vez_nao_arranca():
    """Um movimento só, sem voltar atrás, não é um aceno — é passar."""
    det = DetectorDeAceno()
    varrimento = [0.2 + 0.6 * (i / (2 * FPS)) for i in range(2 * FPS)]
    assert alimentar(det, varrimento) is None


def test_sem_mao_nao_arranca():
    det = DetectorDeAceno()
    assert alimentar(det, [None] * (5 * FPS)) is None


def test_perder_a_mao_esquece_o_que_estava_contado():
    """Meio aceno, a pessoa sai, e outra pessoa entra: não se somam."""
    det = DetectorDeAceno()
    alimentar(det, aceno(segundos=0.5))
    assert det.progresso > 0.0
    alimentar(det, [None] * int(2 * FPS), t0=0.5)
    assert det.progresso == 0.0, "o progresso sobreviveu à mão desaparecer"


def test_progresso_vai_de_zero_a_um():
    det = DetectorDeAceno()
    assert det.progresso == 0.0
    alimentar(det, aceno(segundos=3.0))
    assert det.progresso == 1.0


def test_cinco_acenos_abrem_a_cor_em_cinco_passos():
    """A projeção tapa a câmara com uma cor sólida e tira-lhe um quinto da
    opacidade por cada aceno contado, até o quinto descobrir a pessoa. Isso só
    funciona se o progresso subir mesmo em quintos: mudar `INVERSOES` sem mexer
    na projeção deixava a cor a acabar com um pedaço por levantar, ou a abrir-se
    toda antes de a peça arrancar."""
    det = DetectorDeAceno()
    vistos = {round(det.progresso, 3)}
    for x in aceno(segundos=4.0):
        pronto = det.atualizar(x, 0.0)   # o tempo não conta com a mão sempre visível
        vistos.add(round(det.progresso, 3))
        if pronto:
            break
    assert sorted(vistos) == [0.0, 0.2, 0.4, 0.6, 0.8, 1.0], sorted(vistos)


def test_limpar_repoe_o_detetor():
    det = DetectorDeAceno()
    alimentar(det, aceno(segundos=3.0))
    det.limpar()
    assert det.progresso == 0.0


def test_aceno_pequeno_e_lento_tambem_conta():
    """Nem toda a gente acena com o braço todo. Um aceno curto e calmo — o de
    quem está sentado — tem de servir na mesma."""
    det = DetectorDeAceno()
    assert alimentar(det, aceno(segundos=4.0, hz=1.0, amplitude=0.05)) is not None


def test_o_ambiente_de_regulacao_pede_saudacao():
    """A ligação entre o `.sen` e o motor é por nome de chave: se um dos lados
    mudar o nome, nada dá erro — a peça arranca sem pedir aceno nenhum."""
    import json
    raiz = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    sen = os.path.join(raiz, "Codigo", "interface", "src", "exhibitions",
                       "regulacao-sensorial.sen")
    if not os.path.exists(sen):
        return                      # cópia empacotada não traz as fontes do frontend
    eng = json.load(open(sen, encoding="utf-8"))["engine"]
    assert eng.get("saudacao", {}).get("enabled") is True, "a Regulação Sensorial deixou de pedir aceno"
    fonte = open(ENGINE, encoding="utf-8").read()
    assert 'eng.get("saudacao", {})' in fonte, "o motor deixou de ler a chave `saudacao`"


if __name__ == "__main__":
    testes = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    falhas = 0
    for t in testes:
        try:
            t()
            print(f"  ok  {t.__name__}")
        except AssertionError as e:
            falhas += 1
            print(f"  FALHA  {t.__name__}: {e}")
    print(f"\n{len(testes) - falhas}/{len(testes)} testes a passar.")
    sys.exit(1 if falhas else 0)
