# Sensus AI Hub — aplicação portátil

Esta pasta é a aplicação completa e autónoma. Não precisa de instalação: copia-se para
outro computador e funciona. Tudo o que o motor precisa vem cá dentro — Python, PyTorch,
MediaPipe, os modelos de IA (~10 GB) e a voz Piper em português.

Ocupa cerca de **23 GB**.

## Instalar noutro computador

1. Copiar a pasta inteira `Sensus AI Hub` para o outro PC (Ambiente de
   Trabalho, `C:\`, um disco externo). **Não pôr a pasta dentro de outra com acentos ou
   cedilhas** se for para um disco que não seja o `C:` — ver a nota no fim.
2. Duplo-clique em **`PREPARAR NESTE PC.cmd`**. Verifica a máquina e corrige o atalho para
   o novo caminho. Demora alguns minutos e não instala nada no sistema.
3. Abrir com **`Sensus AI Hub.lnk`**.

O passo 2 é obrigatório: o atalho guarda um caminho absoluto e deixa de funcionar assim
que a pasta muda de sítio ou de máquina.

## O que o computador precisa de ter

| Requisito | Porquê |
|---|---|
| **Windows 10 ou 11, 64 bits** | O executável e o Python incluídos são de 64 bits. |
| **Placa gráfica NVIDIA com driver ≥ 527.41** | O PyTorch incluído é a build CUDA 12.1, que exige esse driver como mínimo (NVIDIA, *CUDA Toolkit Release Notes*). Driver: <https://www.nvidia.com/download/index.aspx> |
| **Webcam** | Biometria (rPPG, íris, Russell) e os ambientes por gesto. |
| **~23 GB livres** | Modelos de IA e ambiente Python. |

Sem GPU NVIDIA a aplicação **abre à mesma**: biometria, música generativa, Air Painting e
Depth Map Tools funcionam. Só a geração de imagem (Fluid AI e Regulação Sensorial) fica
indisponível. O `PREPARAR NESTE PC.cmd` avisa se for esse o caso.

## Primeira utilização noutra GPU

Os motores TensorRT em `Aplicacao\resources\engines` foram compilados para a GPU desta
máquina (RTX 4060 Laptop). Numa GPU diferente não carregam e a aplicação passa
automaticamente para PyTorch — a geração continua a funcionar, um pouco mais lenta
(medido: 113 ms por imagem contra 80 ms com TensorRT).

Para recuperar a velocidade máxima na máquina nova: apagar a pasta
`Aplicacao\resources\engines` e abrir a aplicação. Recompila sozinha no primeiro arranque,
o que demora **cerca de 20 minutos** — uma única vez.

## A Regulação Sensorial começa com um aceno

Ao abrir o ambiente **Regulação Sensorial** aparece um ecrã de boas-vindas e a peça fica à
espera: **sem som e sem imagem gerada** até alguém acenar à câmara. É de propósito. É esse
gesto que marca o início da sessão daquela pessoa, e é a partir dele que o repouso cardíaco
passa a ser medido — se a peça arrancasse com a sala vazia, o "repouso" seria o da cadeira.

**O que fazer:** sentar-se em frente à câmara e **acenar devagar com uma mão**, como quem
cumprimenta. Bastam duas ou três passagens de ida e volta; a barra no ecrã mostra o
reconhecimento a avançar. Passar a mão uma vez à frente da câmara não conta — tem de ser
uma oscilação, para quem apenas passa atrás não arrancar a peça.

Depois de reconhecido, o ambiente arranca e não volta a pedir. Para voltar ao ecrã de
boas-vindas, sai-se e entra-se outra vez no ambiente.

Se a deteção de mãos não carregar nesta máquina, o ambiente **arranca à mesma** com um
aviso no log, em vez de deixar o visitante preso num ecrã que nunca passa.

## Voz — funciona sem instalar nada

O **ditado por voz** e a **análise vocal contínua** correm o Whisper dentro do próprio
pacote, e a **voz bio-ativa** sai do Piper, também incluído. Nada disto precisa de
internet, de servidores nem de contas.

O primeiro ditado de cada arranque demora cerca de **16 segundos**, que é o tempo de
carregar o modelo para a placa gráfica. Todos os seguintes respondem em menos de um
segundo.

## Onde ficam os ficheiros gerados

No **Ambiente de Trabalho** do utilizador: gravações de sessão (`Sensus_Session_*.webm`),
o CSV biométrico e os registos `sensus_main.log` e `sensus_engine.log` — os primeiros a ver
quando alguma coisa não arranca.

## Se alguma coisa falhar

- **"O Windows protegeu o seu PC"** — o executável não está assinado. *Mais informações* →
  *Executar mesmo assim*.
- **Sem imagem da câmara** — *Definições > Privacidade e segurança > Câmara*: ligar o
  acesso, incluindo **"Permitir que as aplicações de ambiente de trabalho acedam à câmara"**.
- **Qualquer outro problema** — correr `PREPARAR NESTE PC.cmd`: aponta o que falta.

## Acentos no caminho (só em discos que não sejam o `C:`)

O MediaPipe, que faz a leitura do rosto, procura os seus modelos pela API antiga do
Windows e não lê caminhos com acentos ou cedilhas. A aplicação contorna isto pela forma
curta 8.3 do caminho, que o Windows gera por omissão **no disco do sistema**. Num disco
secundário ou externo essa forma curta muitas vezes não existe, e aí a biometria (rPPG,
íris, Russell) deixa de arrancar.

Na prática: no `C:` pode-se pôr a pasta onde se quiser, mesmo que o nome de utilizador
tenha acentos. Noutro disco, garantir que nenhuma pasta do caminho tem acentos —
`D:\Apps\Sensus AI Hub` serve; `D:\Aplicações\...` não.
