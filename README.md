# Sensus AI Hub

**Tecnologia que sente contigo.**

A Sensus AI é um protótipo de investigação em design computacional: uma aplicação que lê sinais
do corpo através de uma câmara comum e os transforma, em tempo real, em imagem e música geradas
por IA. O objetivo é criar ambientes sensoriais que respondem a quem está diante deles, pensados
para instalações, salas multissensoriais e contextos de bem-estar.

🌐 [sensus-ai.pt](https://sensus-ai.pt)

> **Protótipo de investigação.** Não é um dispositivo médico e não substitui equipamento
> clínico. As medições feitas pela câmara são estimativas.

---

## O que faz

- **Lê o corpo sem sensores.** A partir da imagem da câmara, estima a frequência cardíaca por
  fotopletismografia remota (rPPG, método POS [1]). Segue também o rosto e os olhos com a malha
  facial do MediaPipe [2]: piscar, raio da íris, simetria e unidades de ação facial (FACS [3]).
  Com isto resume o estado da pessoa em duas dimensões, valência e ativação, segundo o modelo
  circumplexo de Russell [4].
- **Gera imagem em tempo real** com o StreamDiffusion [5] sobre os modelos SD-Turbo e
  SDXL-Turbo [6], e mapas de profundidade com o Depth Anything V2 [7].
- **Compõe música generativa** em cinco camadas, que acompanha os sinais medidos.
- **Ouve e fala.** Faz ditado e análise da voz com o Whisper [8] e tem voz sintetizada com o
  Piper, em português e em inglês.
- **Projeta.** Tem uma janela para segundo ecrã ou projetor e um painel de controlo para quem
  opera a instalação.

Ambientes incluídos: **Regulação Sensorial**, **Fluid AI**, **Air Painting** e **Depth Map Tools**.

A biometria, a imagem, a música e a voz são processadas no próprio computador; a internet só é
usada para as contas.

## Como funciona

```text
câmara ──► motor Python ──────────────► consola Electron ──► interface React
           biometria, imagem,           (ponte IPC)          painel, monitorização
           música e voz                                      e janela de projeção
                      └── telemetria em JSON, fotograma a fotograma ──┘
```

O motor mede, gera e emite a telemetria de cada fotograma: batimento, valência, ativação,
quadrante de Russell, íris, piscar e unidades de ação. A consola lança o motor e encaminha esses
dados para a interface, que devolve comandos ao motor (volumes, câmara, sementes, sensores ativos).

## Estrutura

```text
Codigo/
├── interface/      React 18 + Vite 6 + Tailwind: painéis, monitorização e projeção
├── hub/            consola Electron: lança o motor e faz a ponte IPC
├── motor/          motor Python: rPPG, rosto e olhar, Russell, StreamDiffusion, música, voz
└── supabase/       contas e pagamentos (migração e função do webhook)
Sensus AI Hub/      scripts que preparam a aplicação empacotada noutro computador
```

## Correr a partir do código

Requisitos: Windows 10 ou 11 de 64 bits, webcam, Node.js e Python 3.11. A geração de imagem
precisa de uma placa gráfica NVIDIA com driver 527.41 ou superior; sem ela, a biometria, a
música, o Air Painting e o Depth Map Tools funcionam na mesma.

```sh
# 1. interface
cd Codigo/interface
npm install
npm run build

# 2. a interface compilada passa para a consola
cp dist/index.html ../hub/
cp -r dist/assets ../hub/

# 3. consola Electron (em desenvolvimento usa o motor de Codigo/motor)
cd ../hub
npm install
npm start
```

**O que não está no repositório** e é preciso juntar:

| O quê | Onde | Notas |
|---|---|---|
| Ambiente Python 3.11 | `Codigo/motor/rppg_env/` | PyTorch com CUDA, MediaPipe, OpenCV, SciPy, diffusers, transformers, sounddevice. O `requirements.txt` é o da rPPG-Toolbox com alguns acréscimos e não chega para o motor. |
| Modelos (Hugging Face) | `Codigo/motor/hf_cache/` | `stabilityai/sd-turbo`, `stabilityai/sdxl-turbo`, `madebyollin/taesd`, `depth-anything/Depth-Anything-V2-Small-hf`, `openai/whisper-small`. O motor corre offline: os modelos têm de estar descarregados antes. |
| Voz Piper | variáveis `PIPER_EXE`, `PIPER_MODEL` e `PIPER_MODEL_EN` | [Piper](https://github.com/rhasspy/piper) com as vozes `pt_PT-tugao-medium` (português) e `en_US-amy-medium` (inglês). |
| `adb` | `Codigo/motor/adb/` | Das Android SDK Platform-Tools; só é preciso para usar a câmara de um telemóvel. |
| Fonte da marca | instalada no sistema | PP Neue Montreal é comercial; sem ela a interface usa a fonte do sistema. |

Os testes do motor correm um a um, com o Python do motor: `python test_ativacao.py`, e os
restantes da mesma forma. A aplicação empacotada (cerca de 23 GB, com Python, modelos e Electron)
é distribuída à parte; os scripts de `Sensus AI Hub/` verificam o computador onde ela vai correr.

## Contexto

Protótipo funcional, desenvolvido em 2026 no âmbito de uma bolsa de investigação do ID+,
Instituto de Investigação em Design, Media e Cultura, no IPCA (Instituto Politécnico do Cávado
e do Ave). A bolsa foi financiada pelo ID+, pelo IPCA e pela FCT.

## Referências

1. Wang, W., den Brinker, A. C., Stuijk, S., & de Haan, G. (2017). Algorithmic principles of
   remote PPG. *IEEE Transactions on Biomedical Engineering*, 64(7), 1479–1491.
   https://doi.org/10.1109/TBME.2016.2609282
2. Kartynnik, Y., Ablavatski, A., Grishchenko, I., & Grundmann, M. (2019). Real-time facial
   surface geometry from monocular video on mobile GPUs. arXiv:1907.06724.
3. Ekman, P., & Friesen, W. V. (1978). *Facial Action Coding System*. Consulting Psychologists
   Press.
4. Russell, J. A. (1980). A circumplex model of affect. *Journal of Personality and Social
   Psychology*, 39(6), 1161–1178. https://doi.org/10.1037/h0077714
5. Kodaira, A., et al. (2023). StreamDiffusion: A pipeline-level solution for real-time
   interactive generation. arXiv:2312.12491.
6. Sauer, A., Lorenz, D., Blattmann, A., & Rombach, R. (2023). Adversarial diffusion
   distillation. arXiv:2311.17042.
7. Yang, L., et al. (2024). Depth Anything V2. arXiv:2406.09414.
8. Radford, A., et al. (2023). Robust speech recognition via large-scale weak supervision.
   *Proceedings of the 40th International Conference on Machine Learning*. arXiv:2212.04356.
9. Liu, X., et al. (2023). rPPG-Toolbox: Deep remote PPG toolbox. *NeurIPS 2023 Datasets and
   Benchmarks Track*. arXiv:2210.00716.

## Licença

O código da Sensus AI é distribuído sob a **Apache License 2.0** — ver [`LICENSE`](LICENSE).
Pode ser usado, alterado e redistribuído, também comercialmente, desde que se mantenham os avisos
de autoria e de licença. O nome "Sensus AI" e o logótipo não estão incluídos na licença.

Partes de terceiros, cada uma com a sua licença (ver [`NOTICE`](NOTICE)):

- `Codigo/motor/unsupervised_methods` vem da [rPPG-Toolbox](https://github.com/ubicomplab/rPPG-Toolbox) [9],
  sob a Responsible AI License 1.1 (`Codigo/motor/LICENSE`), com as restrições de uso dessa licença.
- `Codigo/motor/vendor/streamdiffusion_src` é o [StreamDiffusion](https://github.com/cumulo-autumn/StreamDiffusion) [5],
  sob a Apache License 2.0.
- A interface usa componentes do shadcn/ui (MIT) e fotografias do Unsplash
  (`Codigo/interface/ATTRIBUTIONS.md`).
- Os modelos de IA e as vozes Piper não estão incluídos e têm licenças próprias.

---

### In English

Sensus AI is a research prototype in computational design. It reads body signals through an
ordinary webcam: heart rate by remote photoplethysmography, plus facial and eye features mapped
onto Russell's valence–arousal model. It turns those signals, in real time, into AI-generated
imagery (StreamDiffusion) and generative music, for sensory environments that respond to the
person in front of them. Processing runs locally on a Windows PC; image generation needs an
NVIDIA GPU. It is not a medical device. The code is released under the Apache License 2.0.
