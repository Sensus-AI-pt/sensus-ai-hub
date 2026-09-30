#!/usr/bin/env python3
"""Testes à resposta da música ao estado emocional medido.

A pergunta que estes testes respondem é uma só: **ouve-se?** Não basta que os
parâmetros dependam de `val` e `aro` — a diferença entre um canto do plano de
Russell e o outro tem de ser grande ao ponto de um visitante a notar sem lhe
dizerem que existe.

Corre o **código real do motor**: as classes de voz e a `GenerativeMusicEngine`
são extraídas do `engine_sensus_unificado.py` por AST e executadas aqui.
Importar o módulo arrancaria câmara, áudio e StreamDiffusion.

    python test_musica.py
"""

import ast
import os
import sys

import numpy as np

ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "engine_sensus_unificado.py")
ALVOS = {
    "clamp", "SAMPLE_RATE", "BLOCK_SIZE", "synth_base_f0", "synth_volume",
    "_SCALES", "_CHORDS", "_semitone_to_freq", "_freq_to_name", "_NOTE_NAMES",
    "_Voice", "_NoiseVoice", "_KickVoice", "_SnareVoice", "_ClapVoice",
    "_TablaVoice", "_PluckVoice", "_BellVoice", "_MarimbaVoice", "_OrganVoice",
    "_FluteVoice", "_BowedVoice", "_FMVoice", "_instrumento",
    "_GENEROS", "_GENERO_INICIAL", "_COMPASSOS_POR_GENERO", "_RITMOS", "_MAOS", "_MAX_VOZES",
    "GenerativeMusicEngine", "audio_layers", "compensatory", "user_music",
    "music_state", "last_melody_note",
}

#: Quantos compassos de 16 passos cada medição percorre. 64 compassos = 1024
#: passos: chega para as probabilidades assentarem e para os ciclos de 2 e de 4
#: compassos do piano aparecerem os dois.
COMPASSOS = 64
CAMADAS = ("melodia", "piano", "coro", "tabla", "percussao")


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
    ns = {"np": np, "math": __import__("math")}
    exec(compile(ast.Module(body=nos, type_ignores=[]), ENGINE, "exec"), ns)
    em_falta = ALVOS - ns.keys()
    assert not em_falta, f"não encontrado no motor: {em_falta}"
    return ns


M = carregar_do_motor()


def tocar(aro, val=0.0, semente=11):
    """Corre o `_spawn_step` real e devolve o que cada camada tocou.

    Conta notas por camada e soma amplitudes: a amplitude é o que se ouve, e uma
    camada pode mudar de presença sem mudar de número de notas (é o caso do
    bumbo, que nunca falta ao tempo forte mas cresce e encolhe).
    """
    np.random.seed(semente)
    motor = M["GenerativeMusicEngine"]()
    notas = {c: 0 for c in CAMADAS}
    amplitude = {c: 0.0 for c in CAMADAS}
    caudas = []
    for _ in range(COMPASSOS * motor.measure_len):
        antes = len(motor.voices)
        motor._spawn_step(val, aro)
        for camada, voz in motor.voices[antes:]:
            notas[camada] += 1
            amplitude[camada] += float(voz.amp)
            if camada == "melodia" and hasattr(voz, "decay"):
                caudas.append(float(voz.decay))
        motor.voices = []           # já contadas; não deixar crescer sem fim
    return {"notas": notas, "amplitude": amplitude,
            "cauda": float(np.mean(caudas)) if caudas else 0.0}


def andamento(aro, val=0.0):
    M["GenerativeMusicEngine"]._step_interval_samples(
        M["GenerativeMusicEngine"](), aro, val)
    return M["music_state"]["bpm"]


CALMO = tocar(aro=0.05)      # pessoa calma  → música com energia
ATIVADO = tocar(aro=0.95)    # pessoa ativada → música parada


# ── Nenhuma camada pode ficar indiferente ao estado ────────────────────────

def test_todas_as_camadas_respondem_ao_estado():
    """O defeito que isto prende: até 2026-09-17 o piano, o coro, a tabla e a
    percussão tocavam exatamente igual nos quatro quadrantes. Só o andamento, a
    densidade, a escala e o filtro liam o estado — metade do que se ouve não
    respondia a ninguém.

    O critério é a presença de cada camada (soma das amplitudes): tem de mudar
    pelo menos 40% entre os dois extremos do eixo.
    """
    for camada in CAMADAS:
        a, b = CALMO["amplitude"][camada], ATIVADO["amplitude"][camada]
        maior, menor = max(a, b), min(a, b)
        assert menor < maior * 0.6, (
            f"a camada {camada} soa praticamente igual nos dois extremos: "
            f"{a:.1f} calmo contra {b:.1f} ativado")


def test_a_percussao_recua_e_o_pad_avanca():
    """A direção, não só a amplitude. Compensar a agitação é tirar ritmo e pôr
    textura — se a percussão recuasse e mais nada crescesse, compensar seria o
    mesmo que baixar o volume, e a regra do projeto é que o som nunca para."""
    assert ATIVADO["amplitude"]["percussao"] < 0.5 * CALMO["amplitude"]["percussao"]
    assert ATIVADO["amplitude"]["tabla"] < 0.5 * CALMO["amplitude"]["tabla"]
    assert ATIVADO["amplitude"]["coro"] > 1.5 * CALMO["amplitude"]["coro"]


def test_o_som_nunca_para_em_nenhum_ponto_do_plano():
    """Regra dura do projeto: o áudio do ambiente virtual não pode silenciar-se.
    Nos quatro cantos do plano tem de haver notas em, pelo menos, três camadas."""
    for val in (-1.0, 1.0):
        for aro in (0.0, 1.0):
            tocado = tocar(aro, val)["notas"]
            vivas = [c for c in CAMADAS if tocado[c] > 0]
            assert len(vivas) >= 3, f"em val={val} aro={aro} só tocam {vivas}"
            assert tocado["melodia"] > 0 and tocado["coro"] > 0


# ── E a mudança tem de ser grande ──────────────────────────────────────────

def test_a_cauda_das_notas_muda_de_figura():
    """A duração das notas era um degrau binário em aro=0,6 (0,5 s ou 0,9 s).
    Passou a ser contínua e a abrir o dobro: notas articuladas de um lado,
    sobrepostas do outro."""
    assert ATIVADO["cauda"] > 2.5 * CALMO["cauda"], (
        f"cauda média {CALMO['cauda']:.2f} s calmo contra {ATIVADO['cauda']:.2f} s ativado")


def test_o_andamento_atravessa_uma_oitava_de_tempo():
    """Do canto mais calmo ao mais ativado o andamento tem de mais do que
    duplicar — abaixo disso lê-se como a mesma peça um pouco mais depressa."""
    depressa = andamento(aro=0.0, val=1.0)
    devagar = andamento(aro=1.0, val=-1.0)
    assert depressa >= 2 * devagar, f"{devagar} → {depressa} BPM"


def test_a_valencia_ouve_se_sozinha():
    """Metade do plano de Russell é o eixo do humor. Com a ativação fixa, mudar
    de lado tem de mudar o andamento de forma audível — a regra prática são ~5%,
    e aqui pede-se bastante mais."""
    assert andamento(aro=0.5, val=1.0) - andamento(aro=0.5, val=-1.0) >= 30


def test_a_densidade_atravessa_o_intervalo_todo():
    """A densidade é o que mais se ouve mudar: tem de ir de textura rarefeita a
    textura cheia, e não ficar sempre no mesmo registo médio."""
    notas_calmo = CALMO["notas"]["melodia"]
    notas_ativado = ATIVADO["notas"]["melodia"]
    assert notas_ativado < 0.5 * notas_calmo, f"{notas_calmo} contra {notas_ativado} notas"



# ── O género é material, e o material tem de ser mesmo diferente ───────────

def correr_genero(nome, aro=0.5, val=0.0, compassos=32, semente=5):
    """Prende a peça num género e devolve o que ele tocou, por camada.

    `_proximo_genero` a um número enorme desliga a rotação: aqui interessa o que
    **aquele** género faz, não a mistura de vários.
    """
    np.random.seed(semente)
    motor = M["GenerativeMusicEngine"]()
    motor.genero = nome
    motor._proximo_genero = 10 ** 9
    notas = {c: 0 for c in CAMADAS}
    timbres = set()
    escalas = set()
    for _ in range(compassos * motor.measure_len):
        antes = len(motor.voices)
        motor._spawn_step(val, aro)
        for camada, voz in motor.voices[antes:]:
            notas[camada] += 1
            timbres.add(type(voz).__name__)
        escalas.add(M["music_state"]["scale"])
        motor.voices = []
    return {"notas": notas, "timbres": timbres, "escalas": escalas}


GENEROS = M["_GENEROS"]
TOCADO = {nome: correr_genero(nome) for nome in GENEROS}


def test_nenhum_genero_deixa_uma_camada_muda():
    """Cinco faders no painel, cinco camadas a soar — sempre.

    Um género que não toque numa camada deixa o fader dessa camada sem efeito
    durante os 20 a 55 segundos que ele dura. Numa sala isso é indistinguível de
    um fader avariado, e foi o que aconteceu enquanto houve padrões `nenhum`.
    """
    for nome, r in TOCADO.items():
        mudas = [c for c in CAMADAS if r["notas"][c] == 0]
        assert not mudas, f"o género {nome} não toca {mudas}"


def test_os_generos_nao_soam_todos_iguais():
    """A razão de existirem catorze: cada um tem de trazer material próprio.

    Duas medidas, porque nenhuma chega sozinha. A **receita** (timbres da
    melodia, estilo do acorde, baixo, pad, ritmo, padrão de mão) tem de ser
    única em cada género — dois iguais seriam dois nomes para a mesma peça. E a
    **assinatura de render** (as classes de voz que o género instancia mesmo)
    tem de variar, senão a receita era só uma tabela bonita que não chegava ao
    sintetizador. Um par pode partilhar assinatura e distinguir-se pelo resto:
    o dub e o synthwave usam as mesmas classes com escalas, andamento, corte de
    graves e padrões diferentes.
    """
    receitas = {nome: (g["lead"], g["harmonia"], g["baixo"], g["coro"], g["ritmo"], g["mao"])
                for nome, g in GENEROS.items()}
    repetidas = len(GENEROS) - len(set(receitas.values()))
    assert not repetidas, f"{repetidas} géneros são a mesma receita que outro"
    assinaturas = {frozenset(r["timbres"]) for r in TOCADO.values()}
    assert len(assinaturas) >= 12, (
        f"só {len(assinaturas)} texturas distintas em {len(GENEROS)} géneros")


def test_as_tabelas_de_material_nao_tem_entradas_mortas():
    """Uma escala, um ritmo ou um padrão de mão que nenhum género usa é variedade
    que só existe no ficheiro. Ou entra na peça, ou sai da tabela."""
    usadas = set()
    for g in GENEROS.values():
        usadas |= set(g["escalas"])
    assert usadas == set(M["_SCALES"]), f"escalas sem género: {sorted(set(M['_SCALES']) - usadas)}"
    ritmos = {g["ritmo"] for g in GENEROS.values()}
    assert ritmos == set(M["_RITMOS"]), f"ritmos sem género: {sorted(set(M['_RITMOS']) - ritmos)}"
    maos = {g["mao"] for g in GENEROS.values()}
    assert maos == set(M["_MAOS"]), f"padrões de mão sem género: {sorted(set(M['_MAOS']) - maos)}"


def test_a_peca_muda_de_genero_sozinha():
    """Sem rotação, a variedade toda ficava por trás de um valor de configuração.
    Em 64 compassos (uns três minutos) têm de aparecer pelo menos três géneros."""
    for semente in (1, 7, 11, 23):
        np.random.seed(semente)
        motor = M["GenerativeMusicEngine"]()
        vistos = set()
        for _ in range(COMPASSOS * motor.measure_len):
            motor._spawn_step(0.0, 0.5)
            motor.voices = []
            vistos.add(motor.genero)
        assert len(vistos) >= 3, f"semente {semente}: só apareceram {vistos}"


def test_o_eixo_do_humor_vale_o_mesmo_em_todos_os_generos():
    """O género muda o material, **nunca** a leitura da pessoa.

    Se o fator de andamento do género multiplicasse também o termo da valência,
    a mesma distância no eixo do humor valia 28 BPM no Ambient e 48 no Berlin
    school — a mesma medição a significar coisas diferentes conforme a textura,
    que é precisamente o que uma peça de biofeedback não pode fazer.
    """
    for nome in GENEROS:
        motor = M["GenerativeMusicEngine"]()
        motor.genero = nome
        motor._step_interval_samples(0.5, 1.0)
        alto = M["music_state"]["bpm"]
        motor._step_interval_samples(0.5, -1.0)
        baixo = M["music_state"]["bpm"]
        assert abs((alto - baixo) - 40) <= 1, f"{nome}: {baixo} → {alto} BPM"


def test_o_teto_de_polifonia_segura_o_pior_caso():
    """O callback de áudio tem 23 ms por bloco e não pode falhar um — a regra do
    projeto é que o som do ambiente virtual nunca para, e um underrun é um
    estalo. Sem teto, os géneros densos passavam das 140 vozes vivas."""
    np.random.seed(3)
    motor = M["GenerativeMusicEngine"]()
    pico = 0
    for _ in range(COMPASSOS * motor.measure_len):
        motor._spawn_step(1.0, 0.02)        # o canto que mais notas gera
        pico = max(pico, len(motor.voices))
    assert pico <= M["_MAX_VOZES"], f"chegou a {pico} vozes vivas"


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
