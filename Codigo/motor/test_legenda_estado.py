#!/usr/bin/env python3
"""Testes à legenda do estado que fala por cima da imagem gerada.

A legenda vive no frontend (`LegendaEstado.tsx`) e a voz no Electron
(`main.js`), mas as duas dependem de nomes que o motor escolhe. Nada aqui dá
erro quando um dos lados muda de nome: a legenda cala-se, ou fala na língua
errada, e a peça continua a correr como se nada fosse. É isso que estes testes
apanham.

    python test_legenda_estado.py
"""

import ast
import os
import re
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "engine_sensus_unificado.py")
LEGENDA = os.path.join(RAIZ, "Codigo", "interface", "src", "app", "components",
                       "dashboard", "LegendaEstado.tsx")
MAIN_JS = os.path.join(RAIZ, "Codigo", "hub", "main.js")
PRELOAD = os.path.join(RAIZ, "Codigo", "hub", "preload.js")
#: Electron de desenvolvimento, usado para correr de verdade o helper de
#: caminhos do `main.js`. Só existe em quem tem o `npm install` feito.
ELECTRON = os.path.join(RAIZ, "Codigo", "hub", "node_modules", "electron", "dist", "electron.exe")


def ler(caminho):
    return open(caminho, encoding="utf-8").read()


def quadrantes_do_motor():
    arvore = ast.parse(ler(ENGINE))
    for no in arvore.body:
        if isinstance(no, ast.Assign) and getattr(no.targets[0], "id", "") == "_QUADRANTES":
            return set(ast.literal_eval(no.value))
    raise AssertionError("`_QUADRANTES` não encontrado no motor")


def test_a_legenda_cobre_os_quatro_quadrantes():
    """O motor manda o quadrante por nome. Um nome trocado não dá erro nenhum —
    a frase simplesmente nunca aparece para aquele estado."""
    if not os.path.exists(LEGENDA):
        return                      # cópia empacotada não traz as fontes do frontend
    fonte = ler(LEGENDA)
    tabela = fonte.split("const FRASES", 1)[1].split("};", 1)[0]
    chaves = set(re.findall(r"^  (\w+):", tabela, re.M))
    assert chaves == quadrantes_do_motor(), f"legenda tem {chaves}"


def test_cada_quadrante_tem_frases():
    """Um quadrante com a lista vazia é um estado em que a peça emudece."""
    if not os.path.exists(LEGENDA):
        return
    tabela = ler(LEGENDA).split("const FRASES", 1)[1].split("};", 1)[0]
    for chave in quadrantes_do_motor():
        bloco = tabela.split(f"{chave}: [", 1)[1].split("]", 1)[0]
        assert bloco.count('"') >= 2, f"{chave} ficou sem frases"



def test_quarenta_frases_por_quadrante_sorteadas_sem_reposicao():
    """Variedade suficiente para uma sala, e sem repetir à sorte.

    Quatro frases em ciclo fixo davam um minuto de legenda antes de recomeçar:
    quem ficasse dez minutos ouvia a mesma sequência dez vezes. Quarenta, a 15 s
    cada, dão dez minutos. O sorteio tem de ser **sem reposição** — aleatório
    puro repetiria a frase anterior uma vez em quarenta, que numa sala silenciosa
    é o bastante para se notar.
    """
    if not os.path.exists(LEGENDA):
        return
    fonte = ler(LEGENDA)
    tabela = fonte.split("const FRASES", 1)[1].split("};", 1)[0]
    for chave in quadrantes_do_motor():
        bloco = tabela.split(f"{chave}: [", 1)[1].split("]", 1)[0]
        frases = re.findall(r'"([^"]+)"', bloco)
        assert len(frases) >= 40, f"{chave} só tem {len(frases)} frases"
        assert len(set(frases)) == len(frases), f"{chave} tem frases repetidas"
    assert "function proximaFrase" in fonte and "baralhar(" in fonte,         "a legenda voltou a rodar as frases por índice em vez de as sortear"

def test_a_voz_da_legenda_e_inglesa():
    """A legenda é lida em inglês, e o que traz a língua é o modelo do Piper.
    Se o `main.js` deixar de ter voz inglesa, a frase inglesa sai lida por uma
    voz portuguesa — sem aviso nenhum."""
    if not os.path.exists(MAIN_JS):
        return
    fonte = ler(MAIN_JS)
    assert "MODELOS_PIPER" in fonte, "o main.js deixou de escolher modelo por língua"
    assert re.search(r"en:\s*'en_[A-Z]{2}-[\w-]+\.onnx'", fonte), "sem modelo inglês no main.js"
    if os.path.exists(LEGENDA):
        assert 'speakText(texto, "en")' in ler(LEGENDA), "a legenda deixou de pedir inglês"


def test_o_preload_deixa_passar_a_lingua():
    """O argumento da língua atravessa o preload. Perdê-lo é silencioso: o
    `piper-speak` cai no português por omissão e ninguém dá por isso."""
    if not os.path.exists(PRELOAD):
        return
    assert re.search(r"speakText:\s*\(text,\s*voz\)\s*=>\s*ipcRenderer\.invoke\("
                     r"'piper-speak',\s*text,\s*voz\)", ler(PRELOAD)), \
        "o preload deixou de encaminhar a língua para o Piper"


def test_o_caminho_curto_devolve_um_caminho_que_existe():
    """O defeito que deixou a aplicação muda meses a fio.

    O `caminhoCurto` do `main.js` resolve o nome 8.3 de um caminho para o
    `piper.exe` o conseguir ler, e é a **única** coisa entre a legenda e a voz.
    Sem `windowsVerbatimArguments` o Node punha aspas à volta do argumento
    inteiro do `/c`, as aspas do caminho ficavam aninhadas, o `cmd` deixava de
    as ver como delimitador e o `%~sI` devolvia o nome do ficheiro com as aspas
    dentro, prefixado pela unidade atual — medido, até para
    `C:\\Windows\\System32\\notepad.exe`. Essa string era "verdadeira" para o
    `|| piperExe` a seguir, o `spawn` morria com ENOENT dentro de um
    `resolve({success:false})` e mais ninguém olhava.

    Este teste corre a função **a sério**, com o Electron de desenvolvimento, e
    exige que o que ela devolve exista em disco. Qualquer versão que devolva
    lixo falha aqui, em vez de calar a sala.
    """
    if not os.path.exists(ELECTRON):
        return                      # sem `npm install` não há Electron para correr
    fonte = ler(MAIN_JS)
    corpo = fonte.split("function caminhoCurto(dir) {", 1)
    assert len(corpo) == 2, "`caminhoCurto` não encontrado no main.js"
    funcao = "function caminhoCurto(dir) {" + corpo[1].split("\n}\n", 1)[0] + "\n}\n"
    guiao = (
        "const fs = require('fs');\n"
        "const { execFileSync } = require('child_process');\n"
        + funcao +
        "const alvos = [process.argv[2], process.argv[3]];\n"
        "console.log(JSON.stringify(alvos.map(a => {\n"
        "  const r = caminhoCurto(a);\n"
        "  return { pedido: a, devolvido: r, existe: r === null ? null : fs.existsSync(r) };\n"
        "})));\n"
    )
    with tempfile.TemporaryDirectory() as tmp:
        js = os.path.join(tmp, "curto.js")
        with open(js, "w", encoding="utf-8") as f:
            f.write(guiao)
        # Um caminho com espaços (é o caso desta instalação) e outro com
        # acentos (é o caso que a função existe para resolver).
        com_espacos = MAIN_JS
        com_acentos = os.path.expanduser("~")
        saida = subprocess.run(
            [ELECTRON, js, com_espacos, com_acentos],
            capture_output=True, text=True, timeout=120,
            env={**os.environ, "ELECTRON_RUN_AS_NODE": "1"},
        )
        assert saida.returncode == 0, f"o guião falhou: {saida.stderr[:300]}"
        import json
        for caso in json.loads(saida.stdout.strip().splitlines()[-1]):
            assert caso["devolvido"] is None or caso["existe"], (
                f"caminhoCurto({caso['pedido']!r}) devolveu {caso['devolvido']!r}, "
                f"que não existe em disco — a voz morre em silêncio com isto")


def test_o_erro_do_piper_vai_para_o_log():
    """Um `spawn` que falha não pode ficar só no `resolve`. Foi assim que o
    silêncio passou despercebido: o único sítio onde o erro aparecia era um
    objeto devolvido a um `console.error` do renderer que ninguém estava a ler."""
    fonte = ler(MAIN_JS)
    bloco = fonte.split("ipcMain.handle('piper-speak'", 1)[1].split("ipcMain.", 1)[0]
    assert "logMain(" in bloco, "o handler do piper não escreve nada no log da aplicação"


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
