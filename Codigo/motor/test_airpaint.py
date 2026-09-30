#!/usr/bin/env python3
"""Testes ao Air Painting com duas mãos no enquadramento.

Dois defeitos medidos a 2026-09-18, ambos com a mesma causa: **a mesma mão
devolvida duas vezes pelo MediaPipe**. Acontece quando uma mão chega ao bordo do
enquadramento — o seguidor mantém a região antiga e a deteção nova cai por cima.

    1. As duas cópias recebiam papéis opostos (uma pinta, a outra apaga) quase no
       mesmo pixel: a borracha ia atrás do traço e comia-o à medida que ele era
       desenhado. Era o "conflito" com as duas mãos no ecrã.
    2. As duas cópias têm os indicadores à distância zero, o que passava o teste
       da palma sem ninguém ter batido palmas. A tela era limpa sozinha — o
       desenho apagava-se quando a mão saía do ecrã.

Estes testes são **de comportamento**, não estruturais: constroem malhas de mão
falsas e chamam os métodos a sério. A classe é extraída do motor por AST e
executada isolada, para não arrastar torch, cv2 nem mediapipe — os métodos aqui
exercitados só usam `math`, e um teste que precisa de GPU falha por motivos que
não são o código.

    python test_airpaint.py
"""

import ast
import math
import os
import sys

ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "engine_sensus_unificado.py")

# Constantes do motor de que a classe precisa em tempo de execução.
_CONSTANTES = (
    "_PULSO", "_POLEGAR_PONTA", "_INDEX_FINGER_TIP", "_MEDIO_MCP", "_DEDOS_FECHO",
    "_PINCA_MIN", "_PINCA_MAX", "_PALMA_DISTANCIA", "_SOBREPOSICAO_MESMA_MAO",
    "_NUM_CAMADAS", "_CANETAS",
)


def _carregar_airpainter():
    """Devolve a classe `AirPainter` do motor, sem importar o motor.

    Importar o motor puxa torch, mediapipe e sounddevice e abre o áudio. O que
    se quer testar é aritmética sobre 21 pontos, por isso extrai-se só a classe
    e as constantes de que ela depende.
    """
    fonte = open(ENGINE, encoding="utf-8").read()
    arvore = ast.parse(fonte)
    pedacos = []
    for no in arvore.body:
        if isinstance(no, ast.Assign):
            nomes = [a.id for a in no.targets if isinstance(a, ast.Name)]
            # `_PINCA_MIN, _PINCA_MAX = ...` é uma atribuição a um tuplo.
            for a in no.targets:
                if isinstance(a, ast.Tuple):
                    nomes += [e.id for e in a.elts if isinstance(e, ast.Name)]
            if any(n in _CONSTANTES for n in nomes):
                pedacos.append(ast.get_source_segment(fonte, no))
        elif isinstance(no, ast.ClassDef) and no.name == "AirPainter":
            pedacos.append(ast.get_source_segment(fonte, no))
    assert any("class AirPainter" in p for p in pedacos), "classe AirPainter não encontrada no motor"
    espaco = {"math": math, "np": None, "cv2": None, "sys": sys,
              "threading": __import__("threading"), "time": __import__("time")}
    exec("\n\n".join(pedacos), espaco)
    return espaco["AirPainter"]


AirPainter = _carregar_airpainter()


# ── Malhas de mão falsas ──────────────────────────────────────────────────────

class Ponto:
    def __init__(self, x, y):
        self.x, self.y = x, y
        self.z = 0.0


class Mao:
    """O que o MediaPipe devolve em `multi_hand_landmarks[i]`."""

    def __init__(self, landmark):
        self.landmark = landmark


#: Escala da mão nos testes: distância pulso→base do médio (ver `_escala_mao`).
ESCALA = 0.10


def mao(cx, cy, aberta=True, dedos=4):
    """Malha de 21 pontos com a geometria que os testes precisam de ler.

    Só importam os pontos que os métodos testados consultam: o pulso (0), a base
    do médio (9, que fixa a escala), as pontas e as articulações intermédias dos
    quatro dedos. Um dedo conta como esticado quando a ponta está mais longe do
    pulso do que a articulação intermédia (ver `_dedos_estendidos`).
    """
    pontos = [Ponto(cx, cy) for _ in range(21)]
    pontos[9] = Ponto(cx, cy - ESCALA)                      # base do médio
    pontos[4] = Ponto(cx - 0.6 * ESCALA, cy - ESCALA)       # ponta do polegar
    esticados = dedos if aberta else 0
    for i, (ponta, meio) in enumerate(((8, 6), (12, 10), (16, 14), (20, 18))):
        dx = (i - 1.5) * 0.4 * ESCALA
        pontos[meio] = Ponto(cx + dx, cy - 1.5 * ESCALA)
        longe = 2.5 * ESCALA if i < esticados else 0.5 * ESCALA
        pontos[ponta] = Ponto(cx + dx, cy - longe)
    return Mao(pontos)


class Lateralidade:
    """O que o MediaPipe devolve em `multi_handedness[i]`."""

    def __init__(self, etiqueta):
        self.classification = [type("C", (), {"label": etiqueta})()]


def lados(*etiquetas):
    return [Lateralidade(e) for e in etiquetas]


def pintor():
    p = AirPainter()
    p.trocar_maos = False
    return p


# ── A mesma mão detetada duas vezes ───────────────────────────────────────────

def test_copia_da_mesma_mao_e_descartada():
    """Duas deteções sobrepostas e com a mesma etiqueta são uma mão só."""
    p = pintor()
    uma = mao(0.5, 0.5)
    quase_a_mesma = mao(0.502, 0.499)
    detecoes = p._desduplicar([uma, quase_a_mesma], lados("Left", "Left"))
    assert len(detecoes) == 1, "a cópia sobreposta devia ter sido descartada"


def test_duas_maos_a_serio_sobrevivem():
    """Duas mãos afastadas ficam as duas, mesmo com a mesma etiqueta.

    A etiqueta sozinha não podia decidir: o classificador de lateralidade erra, e
    descartar uma mão por causa disso deixaria metade da peça sem funcionar.
    """
    p = pintor()
    detecoes = p._desduplicar([mao(0.25, 0.5), mao(0.75, 0.5)], lados("Left", "Left"))
    assert len(detecoes) == 2, "duas mãos afastadas não são uma cópia"


def test_palma_sobreposta_com_etiquetas_opostas_sobrevive():
    """Uma palma vista de frente sobrepõe as duas mãos na imagem.

    É por isso que a proximidade sozinha não serve de critério: só a etiqueta
    distingue este caso de uma cópia.
    """
    p = pintor()
    detecoes = p._desduplicar([mao(0.50, 0.5), mao(0.51, 0.5)], lados("Left", "Right"))
    assert len(detecoes) == 2, "uma palma a sério não pode ser tomada por uma cópia"


# ── A tela não se apaga sozinha ───────────────────────────────────────────────

def test_copia_da_mesma_mao_nao_limpa_a_tela():
    """O defeito inteiro, do princípio ao fim: mão no bordo, tela intacta.

    Sem a desduplicação, as duas cópias tinham os indicadores à distância zero e
    `_e_palma` dizia que sim. Era assim que o desenho desaparecia quando a mão
    saía do ecrã.
    """
    p = pintor()
    cru = [mao(0.9, 0.5), mao(0.903, 0.498)]
    assert p._e_palma(cru), "sem desduplicar, as cópias passam mesmo no teste da palma"
    maos = [m for m, _ in p._desduplicar(cru, lados("Left", "Left"))]
    assert not p._e_palma(maos), "depois de desduplicar, não há palma nenhuma"


def test_maos_fechadas_nao_limpam_a_tela():
    """Uma palma bate-se com as mãos abertas.

    Sem esta condição, juntar dois dedos a desenhar com as duas mãos apagava
    tudo.
    """
    p = pintor()
    juntas = [mao(0.50, 0.5, aberta=False), mao(0.53, 0.5, aberta=False)]
    assert not p._e_palma(juntas)


def test_palma_a_serio_continua_a_limpar():
    """A correção não podia matar o gesto: duas mãos abertas e juntas limpam."""
    p = pintor()
    assert p._e_palma([mao(0.50, 0.5), mao(0.53, 0.5)])


def test_maos_abertas_mas_afastadas_nao_limpam():
    """Desenhar com as duas mãos ao mesmo tempo não é bater palmas."""
    p = pintor()
    assert not p._e_palma([mao(0.25, 0.5), mao(0.75, 0.5)])


# ── Papéis: duas mãos nunca partilham o mesmo ─────────────────────────────────

def test_duas_maos_nunca_partilham_papel():
    """Mesmo com o classificador a dar a mesma etiqueta às duas.

    Era este o conflito: o ponto anterior de cada traço está guardado por papel,
    e duas mãos com o mesmo papel escreviam no mesmo sítio — o traço saltava de
    uma mão para a outra e desenhava uma reta a uni-las.
    """
    p = pintor()
    maos = [mao(0.25, 0.5), mao(0.75, 0.5)]
    for etiquetas in (("Left", "Left"), ("Right", "Right"), ("Left", "Right")):
        papeis = p._papeis(maos, list(etiquetas))
        assert set(papeis) == {"pintar", "apagar"}, f"papéis repetidos com {etiquetas}"


def test_papel_por_posicao_com_duas_maos():
    """A mão mais à esquerda da imagem é a que pinta.

    O feed não vem espelhado: a mão direita de quem está à frente aparece do lado
    esquerdo da imagem. É o mesmo raciocínio que já governava a leitura da
    etiqueta em `_papel`.
    """
    p = pintor()
    assert p._papeis([mao(0.2, 0.5), mao(0.8, 0.5)], ["Left", "Right"]) == ["pintar", "apagar"]
    assert p._papeis([mao(0.8, 0.5), mao(0.2, 0.5)], ["Left", "Right"]) == ["apagar", "pintar"]


def test_trocar_maos_inverte_os_papeis():
    """O botão de trocar as mãos continua a valer com a atribuição por posição."""
    p = pintor()
    p.trocar_maos = True
    assert p._papeis([mao(0.2, 0.5), mao(0.8, 0.5)], ["Left", "Right"]) == ["apagar", "pintar"]


def test_uma_mao_so_usa_a_etiqueta():
    """Com uma mão não há colisão possível, e a etiqueta distingue-a mesmo
    quando ela está do lado 'errado' da imagem."""
    p = pintor()
    assert p._papeis([mao(0.8, 0.5)], ["Left"]) == ["pintar"]
    assert p._papeis([mao(0.2, 0.5)], ["Right"]) == ["apagar"]


if __name__ == "__main__":
    falhas = 0
    for nome, fn in sorted(globals().items()):
        if nome.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok   {nome}")
            except AssertionError as ex:
                falhas += 1
                print(f"  FALHA {nome}: {ex}")
    print("\nTodos os testes passaram." if not falhas else f"\n{falhas} teste(s) a falhar.")
    sys.exit(1 if falhas else 0)
