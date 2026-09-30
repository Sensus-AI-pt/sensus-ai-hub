#!/usr/bin/env python3
"""Testes ao eixo de ativação de Russell e à direção da regulação compensatória.

Corre o **código real do motor**: funções, constantes e até métodos são
extraídos do `engine_sensus_unificado.py` por AST e executados aqui. Importar o
módulo arrancaria câmara, áudio e StreamDiffusion.

    python test_ativacao.py
"""

import ast
import math
import os
import sys
from collections import deque

import numpy as np

ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "engine_sensus_unificado.py")
ALVOS = {
    "clamp", "ReferenciaDeRepouso", "calcular_ativacao", "_ativacao", "ATIV_PESOS",
    "denoising_por_ativacao", "AMPLITUDE_DENOISING",
    "SAMPLE_RATE", "compensatory", "user_music", "music_state", "_QUADRANTES",
    "_GENEROS", "_GENERO_INICIAL",
    "ATIV_HISTERESE_ARO", "PISCAR_JANELA_S", "_piscar",
    "registar_piscar", "taxa_de_piscar", "redefinir_piscar",
}
#: Método da classe do motor musical que define o andamento. Extraído à parte
#: porque a classe inteira arrasta o `sounddevice`.
METODO_ANDAMENTO = ("GenerativeMusicEngine", "_step_interval_samples")

FRONTEIRA = 0.5   # fronteira dos quadrantes superiores de Russell
FPS = 20          # taxa típica do loop do motor


def carregar_do_motor():
    arvore = ast.parse(open(ENGINE, encoding="utf-8").read())
    nos = []
    for no in arvore.body:
        if isinstance(no, (ast.FunctionDef, ast.ClassDef)) and no.name in ALVOS:
            nos.append(no)
        elif isinstance(no, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id in ALVOS for t in no.targets
        ):
            nos.append(no)
        elif isinstance(no, ast.ClassDef) and no.name == METODO_ANDAMENTO[0]:
            for sub in no.body:
                if isinstance(sub, ast.FunctionDef) and sub.name == METODO_ANDAMENTO[1]:
                    nos.append(sub)
    ns = {"np": np, "math": __import__("math"), "time": __import__("time"),
          "deque": deque}
    exec(compile(ast.Module(body=nos, type_ignores=[]), ENGINE, "exec"), ns)
    em_falta = (ALVOS | {METODO_ANDAMENTO[1]}) - ns.keys()
    assert not em_falta, f"não encontrado no motor: {em_falta}"
    return ns


M = carregar_do_motor()
calcular_ativacao = M["calcular_ativacao"]
denoising_por_ativacao = M["denoising_por_ativacao"]
ReferenciaDeRepouso = M["ReferenciaDeRepouso"]

#: Ativação mínima para **entrar** no quadrante ativado (a saída é mais baixa,
#: por histerese). É contra este número que o teto dos empurrões se mede.
ENTRAR_EM_ATIVADO = FRONTEIRA + M["ATIV_HISTERESE_ARO"]


class _MotorMusicalFalso:
    """Só o suficiente para correr o método real do andamento.

    O `genero` é o do arranque, e é fixo de propósito: aqui mede-se o eixo da
    ativação, não a textura. O género que a peça escolher por cima disto muda o
    andamento por um fator, nunca a direção.
    """
    def __init__(self):
        self.measure_step = 0
        self.genero = M["_GENERO_INICIAL"]


def bpm_da_musica(aro, val=0.0):
    """Andamento que o motor musical escolhe, pelo método real."""
    M["_step_interval_samples"](_MotorMusicalFalso(), aro, val)
    return M["music_state"]["bpm"]


def correr_motor(bpm_de, energia=0.009, au5=0.0, au26=0.0, usa_movimento=True,
                 segundos=300, piscar_de=None):
    """Corre a `calcular_ativacao` REAL ao longo de uma sessão simulada.

    Reinicia o estado das referências de repouso do motor, alimenta o BPM pela
    mesma média móvel de 20 amostras a 1 Hz que o motor usa, e devolve a lista
    de ativações. `energia` constante = pessoa parada: a referência de repouso
    do movimento assenta nela e o componente fica em ~0.
    """
    M["_ativacao"]["bpm"].limpar()
    M["_ativacao"]["mov"].limpar()
    M["_ativacao"]["piscar"].limpar()
    energia_de = energia if callable(energia) else (lambda _t: energia)
    hist, ultimo, bpm, saida = deque(maxlen=20), -99.0, None, []
    for i in range(segundos * FPS):
        t = i / FPS
        if t - ultimo >= 1.0:          # RPPG_INTERVALO_S
            ultimo = t
            hist.append(bpm_de(t))
            bpm = int(np.mean(hist))
        aro, comp = calcular_ativacao(bpm or 0, energia_de(t), au5, au26,
                                      taxa_piscar=piscar_de(t) if piscar_de else None,
                                      usa_movimento=usa_movimento)
        if comp["cardiaco"] is not None:
            saida.append(aro)
    return saida


def rampa(subida_bpm, repouso=70.0):
    """Um minuto de repouso, um a subir, um e meio no topo, um a descer."""
    def hr(t):
        if t < 60:    return repouso
        if t < 120:   return repouso + subida_bpm * (t - 60) / 60.0
        if t < 210:   return repouso + subida_bpm
        return max(repouso, repouso + subida_bpm * (1 - (t - 210) / 60.0))
    return hr


# ── O eixo tem de conseguir subir ──────────────────────────────────────────

def test_subida_moderada_chega_ao_quadrante_superior():
    """Uma pessoa sentada e quieta com uma subida real de +10 bpm tem de lá chegar.

    É o caso de uso da peça: alguém sentado a regular-se, que não se mexe. Antes
    desta correção o pico era 0,26 — a metade de cima do plano era inalcançável
    sem a pessoa se pôr a mexer muito.
    """
    picos = correr_motor(rampa(10))
    assert max(picos) >= FRONTEIRA, f"pico de apenas {max(picos):.3f}"


def test_estar_quieto_nao_e_estar_calmo():
    """Coração muito acima do repouso e corpo parado tem de ler como ativado.

    Numa peça de regulação a pessoa está quieta de propósito. Antes, o movimento
    pesava 0,30 contra a ativação: o teto de quem estava parado era 0,565 mesmo
    com o componente cardíaco saturado — a imobilidade votava 'calmo'.
    """
    picos = correr_motor(rampa(40))     # subida grande: satura o cardíaco
    assert max(picos) >= 0.9, f"parado com o coração no máximo dá só {max(picos):.3f}"


def test_desligar_o_sensor_de_movimento_nao_pode_subir_a_ativacao():
    """O absurdo que denunciou a causa: com a média ponderada, desligar o sensor
    de fluxo renormalizava os pesos e subia o teto de 0,565 para 0,786."""
    com = max(correr_motor(rampa(40), usa_movimento=True))
    sem = max(correr_motor(rampa(40), usa_movimento=False))
    assert sem <= com + 1e-9, f"desligar o sensor subiu a ativação: {com:.3f} -> {sem:.3f}"


def test_movimento_e_rosto_so_empurram_para_cima():
    """Nenhum dos dois pode baixar a ativação que o cardíaco já estabeleceu."""
    base = max(correr_motor(rampa(10), au5=0.0, au26=0.0))
    assert max(correr_motor(rampa(10), au5=1.0, au26=1.0)) >= base - 1e-9
    assert max(correr_motor(rampa(10), energia=0.05)) >= base - 1e-9


def test_o_teto_dos_empurroes_passa_a_fronteira():
    """O defeito, na sua forma mais crua.

    Movimento, pestanejo e rosto somavam **0,45** de empurrão máximo, e entrar no
    quadrante ativado exige 0,55. Ou seja: nenhuma quantidade de agitação visível
    — mexer-se depressa e sem parar, com as AUs saturadas — mudava de quadrante
    sem o cardíaco alinhar. E o rPPG de quem se mexe muito é o mais ruidoso de
    todos, que é como quem diz: a peça era cega à agitação precisamente quando
    ela existia.
    """
    teto = sum(M["ATIV_PESOS"].values())
    assert teto > ENTRAR_EM_ATIVADO, (
        f"os empurrões chegam a {teto:.2f} e entrar em ativado exige "
        f"{ENTRAR_EM_ATIVADO:.2f}: a agitação visível nunca muda de quadrante")


def test_mexer_se_depressa_e_sem_parar_e_estado_agitado():
    """Uma pessoa que se agita a meio da sessão, com o coração no próprio repouso.

    Trinta segundos sentada e quieta, depois movimento contínuo e forte. Tem de
    atravessar para o quadrante ativado por causa do movimento, sem ajuda nenhuma
    do cardíaco — que aqui está fixo no valor em que assentou o repouso.
    """
    agitada = lambda t: 0.007 if t < 30 else 0.30
    aro = correr_motor(lambda _t: 72.0, energia=agitada, segundos=180)
    depois = aro[int(60 * FPS):]        # já com o movimento estabelecido
    assert max(depois) >= ENTRAR_EM_ATIVADO, (
        f"movimento rápido e constante chega só a {max(depois):.3f}")
    # E não é um pico: tem de se manter lá, ou o quadrante nunca fixa (1,5 s de
    # permanência mínima).
    acima = sum(1 for a in depois if a >= FRONTEIRA) / len(depois)
    assert acima > 0.9, f"só {100 * acima:.0f}% do tempo acima da fronteira"


def test_piscar_muito_empurra_a_ativacao():
    """Pestanejar muito acima do próprio normal tem de contar como ativação.

    Antes não contava de todo: os pestanejos eram contados para a telemetria
    (`blinks`) e nunca entravam no eixo.
    """
    normal = correr_motor(lambda _t: 72.0, piscar_de=lambda _t: 16.0, segundos=180)
    muito = correr_motor(lambda _t: 72.0,
                         piscar_de=lambda t: 16.0 if t < 60 else 40.0, segundos=180)
    assert max(muito) > max(normal) + 0.15, (
        f"pestanejar 40/min contra 16/min move a ativação de {max(normal):.3f} "
        f"para apenas {max(muito):.3f}")


def test_a_taxa_de_piscar_nao_existe_antes_de_haver_janela():
    """Devolver zero em vez de None faria a referência de repouso assentar em
    zero, e a partir daí qualquer pestanejo leria como ativação."""
    M["redefinir_piscar"]()
    assert M["taxa_de_piscar"](agora=0.0) is None
    M["registar_piscar"](agora=0.0)
    assert M["taxa_de_piscar"](agora=5.0) is None, "janela ainda não encheu"
    janela = M["PISCAR_JANELA_S"]
    for k in range(1, 6):
        M["registar_piscar"](agora=k * 2.0)
    taxa = M["taxa_de_piscar"](agora=janela)
    assert taxa == 6 * (60.0 / janela), f"taxa {taxa}"
    # Passada a janela, os pestanejos velhos saem da conta.
    assert M["taxa_de_piscar"](agora=janela + 60.0) == 0.0


# ── E não pode subir sozinho ───────────────────────────────────────────────

def test_pessoa_calma_fica_em_baixo():
    """Guarda de especificidade. Já houve uma versão que passou 74,5% do tempo
    na metade de cima — o defeito oposto, e igualmente inútil."""
    picos = correr_motor(lambda t: 70.0)
    assert max(picos) < 0.35, f"pessoa em repouso chegou a {max(picos):.3f}"


def test_sem_nenhum_sinal_a_ativacao_e_zero():
    M["_ativacao"]["bpm"].limpar()
    M["_ativacao"]["mov"].limpar()
    aro, comp = calcular_ativacao(0, 0.0, 0.0, 0.0, usa_movimento=False)
    assert aro == 0.0 and comp["cardiaco"] is None


def test_uma_leitura_ma_nao_prende_o_eixo_em_cima():
    """30 s de rPPG mau não podem deixar o eixo em cima o resto da sessão.

    O caso real: alguém vira a cara ou a luz muda, o rPPG lê 55 bpm durante meio
    minuto numa pessoa que está nos 75, e a referência de repouso — que descia em
    5 s atrás de qualquer valor mais baixo e subia 0,6 bpm/min — ficava 20 bpm
    abaixo do repouso verdadeiro. Medido antes da correção: componente cardíaco
    com mediana **1,000** e **100%** do tempo na metade de cima a partir daí.
    """
    def hr(t):
        return 55.0 if 100 <= t < 130 else 75.0
    depois = correr_motor(hr, segundos=420)[200 * FPS:]
    em_cima = sum(1 for a in depois if a >= FRONTEIRA) / len(depois)
    assert em_cima < 0.05, f"{100 * em_cima:.0f}% do tempo em cima depois do episódio"


def test_o_ruido_do_rppg_nao_sobe_o_eixo_sozinho():
    """Uma pessoa em repouso com o BPM a oscilar tem de continuar em baixo.

    A `test_pessoa_calma_fica_em_baixo` alimenta um BPM constante, e um piso que
    persegue o mínimo passa nesse caso — não há mínimo abaixo do valor. Com
    oscilação há, e o normal fica permanentemente acima do piso: é assim que o
    eixo sobe sem que a pessoa se ative.
    """
    def hr(t):
        return 72.0 + 6.0 * math.sin(t / 7.0) + 4.0 * math.sin(t / 2.3)
    aro = correr_motor(hr, segundos=420)
    mediana = sorted(aro)[len(aro) // 2]
    assert mediana < 0.30, f"repouso com ruído dá mediana {mediana:.3f}"
    assert max(aro) < FRONTEIRA, f"repouso com ruído chegou a {max(aro):.3f}"


# ── Regulação compensatória: som e imagem na mesma direção ─────────────────

def test_som_e_imagem_sao_compensatorios_e_andam_juntos():
    """O pedido: pessoa calma → som agitado; pessoa agitada → som calmo. E a
    imagem tem de acompanhar, não contrariar.

    Andamento e denoising têm ambos de **descer** quando a ativação sobe: menos
    batidas por minuto e uma imagem mais colada à câmara para quem está ativado;
    mais andamento e mais transformação para quem está calmo.
    """
    eixo = [i / 10 for i in range(11)]
    andamentos = [bpm_da_musica(a) for a in eixo]
    denoisings = [denoising_por_ativacao(a, 0.65) for a in eixo]

    for i in range(1, len(eixo)):
        assert andamentos[i] <= andamentos[i - 1], f"andamento subiu com a ativação em aro={eixo[i]}"
        assert denoisings[i] <= denoisings[i - 1], f"denoising subiu com a ativação em aro={eixo[i]}"
    assert andamentos[0] > andamentos[-1], "o andamento não muda ao longo do eixo"
    assert denoisings[0] > denoisings[-1], "o denoising não muda ao longo do eixo"


def test_o_eixo_todo_e_audivel():
    """De pouco serve a direção certa se a diferença não se ouvir. Com o eixo
    preso em baixo, o andamento andava sempre à volta de 123 BPM."""
    calmo, agitado = bpm_da_musica(0.0), bpm_da_musica(1.0)
    assert calmo - agitado >= 60, f"apenas {calmo - agitado} BPM entre os extremos"


def test_prompts_do_ambiente_usam_as_chaves_do_motor():
    """Uma chave mal escrita no `.sen` não daria erro nenhum — a prompt seria
    simplesmente ignorada e a imagem ficaria igual nos quatro quadrantes."""
    import json
    sen = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__)))), "Codigo", "interface", "src", "exhibitions",
        "regulacao-sensorial.sen")
    if not os.path.exists(sen):
        return                      # cópia empacotada não traz as fontes do frontend
    quadrantes = set(M["_QUADRANTES"])
    prompts = json.load(open(sen, encoding="utf-8"))["engine"]["streamdiffusion"].get(
        "quadrantPrompts", {})
    assert prompts, "o ambiente de regulação ficou sem prompts por quadrante"
    assert set(prompts) <= quadrantes, f"chaves desconhecidas: {set(prompts) - quadrantes}"
    assert set(prompts) == quadrantes, f"quadrantes por preencher: {quadrantes - set(prompts)}"
    assert all(t.strip() for t in prompts.values()), "há prompts vazias"


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
