#!/usr/bin/env python3
"""Testes à escolha da fonte de imagem (câmara do PC ↔ telemóvel).

Estes testes são **estruturais**: leem o motor e exigem que os quatro defeitos
medidos a 2026-09-17 não possam voltar. Não abrem câmara nenhuma, de propósito —
um teste que depende de haver webcam livre falha por motivos que não são o
código, e a verificação ao vivo desta correção está registada no CHANGELOG (o
motor a correr, a trocar de fonte pelo stdin, sem morrer).

O que aconteceu, para o caso de alguém querer voltar a mexer aqui: uma passagem
pelo telemóvel deixava a câmara do PC inutilizável até reiniciar a aplicação.
Quatro causas somadas, todas silenciosas.

    python test_camara.py
"""

import ast
import os
import re
import sys

ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "engine_sensus_unificado.py")


def fonte():
    return open(ENGINE, encoding="utf-8").read()


def corpo_de(nome):
    """Devolve o código-fonte de uma função de topo do motor."""
    arvore = ast.parse(fonte())
    for no in arvore.body:
        if isinstance(no, ast.FunctionDef) and no.name == nome:
            return ast.get_source_segment(fonte(), no)
    raise AssertionError(f"função `{nome}` não encontrada no motor")


def sem_comentarios(codigo):
    """Tira os comentários.

    Estes testes procuram palavras no **código**, e as notas que explicam cada
    defeito citam-no pelo nome (`break`, `isOpened()`): sem isto, os testes
    falhavam por causa das próprias explicações.
    """
    return "\n".join(re.sub(r"#.*$", "", l) for l in codigo.splitlines())


def bloco_apos(marca, linhas=30):
    """As `linhas` seguintes a uma marca no texto do motor, sem comentários."""
    texto = fonte()
    assert marca in texto, f"marca não encontrada: {marca!r}"
    return sem_comentarios("\n".join(texto.split(marca, 1)[1].splitlines()[:linhas]))


def test_perder_o_telemovel_nao_mata_o_motor():
    """O defeito mais caro dos quatro: `if not phone_client.alive: break`.

    Perder a ligação ao telemóvel terminava o laço principal, e com ele o
    processo. A partir daí nenhum comando chegava ao motor — incluindo o
    `SET_CAMERA_SOURCE pc:0` — e a câmara do PC ficava irrecuperável sem
    reiniciar a aplicação. Era literalmente o que o utilizador descreveu.
    """
    bloco = bloco_apos("if not phone_client.alive:", 24)
    corpo = bloco.split("frame = phone_client.last_frame", 1)[0]
    assert "break" not in corpo, "perder o telemóvel volta a matar o motor"
    assert "abrir_webcam" in corpo, "perder o telemóvel tem de voltar à câmara do PC"


def test_trocar_de_camara_do_pc_reabre_sempre():
    """Escolher outra câmara do PC tem de fechar a que está e abrir a nova.

    Antes a reabertura estava condicionada a `not cap_webcam.isOpened()`: com a
    câmara 0 aberta, escolher a 1 não fazia absolutamente nada — nem erro, nem
    troca, nem aviso.
    """
    bloco = bloco_apos('if req_kind == "pc":', 22)
    assert "cap_webcam.release()" in bloco, "a câmara anterior não é fechada"
    assert "abrir_webcam(cam_index)" in bloco, "a câmara nova não é aberta"
    reabertura = bloco.split("abrir_webcam(cam_index)", 1)[0]
    assert "isOpened()" not in reabertura, (
        "a reabertura voltou a depender do `isOpened()` da câmara anterior")


def test_o_telemovel_que_nao_espelha_tem_prazo():
    """Um telemóvel que liga e nunca entrega imagem não pode prender o laço.

    O `scrcpy.Client` dá-se por vivo sem mandar um frame — ecrã bloqueado,
    autorização de espelhamento por aceitar — e o `continue` deixava o motor sem
    imagem **e sem telemetria**: a interface ficava com o último frame da webcam
    congelado e nada dizia porquê.
    """
    texto = fonte()
    assert "TELEFONE_SEM_IMAGEM_S" in texto, "não há prazo para o telemóvel sem imagem"
    bloco = bloco_apos("frame = phone_client.last_frame", 30)
    assert "TELEFONE_SEM_IMAGEM_S" in bloco, "o prazo não é usado onde se espera pelo frame"
    assert "abrir_webcam" in bloco, "esgotado o prazo, tem de voltar à câmara do PC"


def test_abrir_webcam_confirma_que_ha_imagem():
    """`isOpened()` diz que o dispositivo abriu, não que entrega imagem.

    É a mesma distinção que o `preparar.ps1` aprendeu com o MediaPipe: importar
    a biblioteca não é carregar os modelos. Uma câmara ocupada por outra
    aplicação abre e nunca entrega nada.
    """
    codigo = sem_comentarios(corpo_de("abrir_webcam"))
    assert ".read()" in codigo, "abrir_webcam não confirma que a câmara entrega imagem"
    assert "CAP_MSMF" in codigo and "CAP_DSHOW" in codigo, "só tenta um backend"
    assert "time.sleep" in codigo, (
        "sem espera entre tentativas: o DirectShow não liberta o dispositivo no "
        "instante do release() e a reabertura falha")


def test_a_fonte_real_vai_na_telemetria():
    """A interface tem de poder dizer a verdade.

    Sem isto, mostrava a câmara que o utilizador escolheu enquanto o motor
    estava em simulação, e a única pista era uma linha de stderr que ninguém lê.
    """
    texto = fonte()
    assert texto.count('"camera": dict(camera_estado)') >= 2, (
        "a fonte real não vai nos dois formatos de telemetria (com e sem rosto)")
    assert '"erro"' in corpo_de("parse_camera_source") or "camera_estado" in texto


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
