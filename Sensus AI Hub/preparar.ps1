# Sensus AI Hub — preparação e verificação do PC.
# Corre a partir de "PREPARAR NESTE PC.cmd". Não instala nada no sistema:
# só confirma o que a máquina tem e refaz o atalho para o caminho atual.

$raiz = Split-Path -Parent $MyInvocation.MyCommand.Definition
$app  = Join-Path $raiz 'Aplicacao'
$res  = Join-Path $app 'resources'
$py   = Join-Path $res 'python-standalone\python.exe'
$erros = 0
$avisos = 0

function Resultado($estado, $texto) {
    switch ($estado) {
        'ok'    { Write-Host "  [OK]    $texto" -ForegroundColor Green }
        'aviso' { Write-Host "  [AVISO] $texto" -ForegroundColor Yellow; $script:avisos++ }
        'erro'  { Write-Host "  [ERRO]  $texto" -ForegroundColor Red;    $script:erros++ }
    }
}

Write-Host ""
Write-Host "  SENSUS AI HUB — verificação deste computador" -ForegroundColor Cyan
Write-Host "  Pasta: $raiz"
Write-Host ""

# ─── 1. Sistema ───────────────────────────────────────────────────────────
Write-Host "1. Sistema operativo"
$os = Get-CimInstance Win32_OperatingSystem
if ([Environment]::Is64BitOperatingSystem) {
    Resultado 'ok' "$($os.Caption) (64 bits)"
} else {
    Resultado 'erro' "Windows de 32 bits — a aplicação exige 64 bits."
}

# ─── 2. GPU e driver ──────────────────────────────────────────────────────
# O PyTorch incluído é a build CUDA 12.1, que exige driver NVIDIA >= 527.41
# (NVIDIA, CUDA Toolkit Release Notes, tabela de compatibilidade mínima).
Write-Host ""
Write-Host "2. Placa gráfica"
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if (-not $smi) {
    Resultado 'aviso' "nvidia-smi não encontrado — sem GPU NVIDIA ou sem driver instalado."
    Write-Host "          Biometria, música e Air Painting funcionam; a geração de imagem (Fluid AI"
    Write-Host "          e Regulação Sensorial) precisa de GPU NVIDIA. Driver: https://www.nvidia.com/download/index.aspx"
} else {
    $linha = (& nvidia-smi --query-gpu=name,driver_version --format=csv,noheader) | Select-Object -First 1
    $partes = $linha -split ',\s*'
    $nome = $partes[0]; $drv = $partes[1]
    $drvNum = [double]($drv -replace '^(\d+\.\d+).*$', '$1')
    if ($drvNum -ge 527.41) {
        Resultado 'ok' "$nome — driver $drv"
    } else {
        Resultado 'erro' "$nome — driver $drv é anterior a 527.41, exigido pelo CUDA 12.1. Atualizar em https://www.nvidia.com/download/index.aspx"
    }
}

# ─── 3. Ficheiros do pacote ───────────────────────────────────────────────
Write-Host ""
Write-Host "3. Ficheiros da aplicação"
$essenciais = @(
    'Sensus AI Hub.exe|..\Sensus AI Hub.exe',
    'motor Electron|app.asar',
    'motor Python|engine_sensus_unificado.py',
    'editor de nodes|node_graph.py',
    'Python autónomo|python-standalone\python.exe',
    'modelo de imagem (sd-turbo)|hf_cache\hub\models--stabilityai--sd-turbo',
    'modelo de profundidade|hf_cache\hub\models--depth-anything--Depth-Anything-V2-Small-hf',
    'voz Piper (pt-PT)|piper\piper.exe',
    'voz Piper (en-US)|piper\en_US-amy-medium.onnx',
    'métodos rPPG|unsupervised_methods',
    'StreamDiffusion|vendor',
    'configuração da geração|td_config.yaml'
)
foreach ($e in $essenciais) {
    $nome, $rel = $e -split '\|'
    if (Test-Path -LiteralPath (Join-Path $res $rel)) { Resultado 'ok' $nome }
    else { Resultado 'erro' "$nome em falta ($rel) — a cópia da pasta ficou incompleta." }
}

# ─── 4. Motor Python ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "4. Motor Python (pode demorar ~30 s)"
if (-not (Test-Path -LiteralPath $py)) {
    Resultado 'erro' "python-standalone\python.exe não existe — não dá para testar."
} else {
    $teste = @'
import os
os.environ["GLOG_minloglevel"] = "2"          # cala o glog do MediaPipe
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"      # cala o TensorFlow Lite
import importlib, sys
falhas = []
for m in ("torch", "cv2", "mediapipe", "numpy", "scipy", "sounddevice", "PIL"):
    try:
        importlib.import_module(m)
    except Exception as e:
        falhas.append("%s (%s)" % (m, type(e).__name__))
import torch
print("IMPORTS:" + (",".join(falhas) if falhas else "todos"))
try:
    import numpy as np, mediapipe as mp
    fm = mp.solutions.face_mesh.FaceMesh(static_image_mode=True, max_num_faces=1,
                                         refine_landmarks=True)
    fm.process(np.zeros((480, 640, 3), dtype=np.uint8))
    fm.close()
    print("FACEMESH:ok")
except Exception as e:
    print("FACEMESH:%s" % type(e).__name__)
print("CUDA:%s|%s" % (torch.cuda.is_available(),
                      torch.cuda.get_device_name(0) if torch.cuda.is_available() else "-"))
'@
    $tmp = Join-Path $env:TEMP 'sensus_check.py'
    Set-Content -LiteralPath $tmp -Value $teste -Encoding UTF8
    $saida = & $py $tmp
    Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
    $imp = ($saida | Where-Object { $_ -like 'IMPORTS:*' }) -replace '^IMPORTS:', ''
    $cud = ($saida | Where-Object { $_ -like 'CUDA:*' })   -replace '^CUDA:', ''
    if ($imp -eq 'todos') { Resultado 'ok' "bibliotecas carregam (torch, OpenCV, MediaPipe, …)" }
    elseif ($imp)         { Resultado 'erro' "bibliotecas com falha: $imp" }
    else                  { Resultado 'erro' "o Python não arrancou — ver a saída acima." }

    # O import do MediaPipe passa mesmo quando os modelos nao carregam: a camada C++
    # resolve os .binarypb/.tflite pela API ANSI do Windows e falha em caminhos com
    # acentos. So instanciar o FaceMesh prova que a biometria arranca.
    $fmesh = ($saida | Where-Object { $_ -like 'FACEMESH:*' }) -replace '^FACEMESH:', ''
    if ($fmesh -eq 'ok') {
        Resultado 'ok' "MediaPipe carrega os modelos do rosto (biometria operacional)"
    } elseif ($fmesh) {
        Resultado 'erro' "MediaPipe nao carrega os modelos do rosto ($fmesh) — sem biometria."
        if ([Text.Encoding]::UTF8.GetByteCount($raiz) -ne $raiz.Length) {
            Write-Host "          O caminho tem acentos: $raiz"
            Write-Host "          Mover a pasta para um caminho so com letras sem acentos (ver LEIA-ME.md)."
        }
    }

    if ($cud -like 'True*') {
        Resultado 'ok' "CUDA disponível na GPU $(($cud -split '\|')[1])"
    } elseif ($cud) {
        Resultado 'aviso' "o PyTorch não vê CUDA — geração de imagem indisponível (o resto funciona)."
    }
}

# ─── 5. Câmara ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "5. Câmara"
if (Test-Path -LiteralPath $py) {
    Push-Location $res
    $cams = & $py -u 'engine_sensus_unificado.py' '--list-cameras' 2>$null
    Pop-Location
    try { $lista = ($cams -join '' | ConvertFrom-Json).cameras } catch { $lista = @() }
    if ($lista.Count -gt 0) {
        Resultado 'ok' "$($lista.Count) câmara(s): $(($lista | ForEach-Object { $_.label }) -join ', ')"
    } else {
        Resultado 'aviso' "nenhuma câmara detetada. Ligar a webcam e permitir o acesso em Definições > Privacidade e segurança > Câmara (incluindo 'aplicações de ambiente de trabalho')."
    }
}

# ─── 6. Atalho ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "6. Atalho"
$exe = Join-Path $app 'Sensus AI Hub.exe'
if (Test-Path -LiteralPath $exe) {
    $lnk = Join-Path $raiz 'Sensus AI Hub.lnk'
    $sh = New-Object -ComObject WScript.Shell
    $s = $sh.CreateShortcut($lnk)
    $s.TargetPath = $exe
    $s.WorkingDirectory = $app
    $s.IconLocation = $exe
    $s.Description = 'Sensus AI Hub'
    $s.Save()
    Resultado 'ok' "'Sensus AI Hub.lnk' a apontar para esta pasta."
} else {
    Resultado 'erro' "'Sensus AI Hub.exe' não encontrado — atalho não criado."
}

# ─── Resumo ───────────────────────────────────────────────────────────────
Write-Host ""
if ($erros -gt 0) {
    Write-Host "  $erros erro(s) e $avisos aviso(s). Resolver os erros antes de abrir a aplicação." -ForegroundColor Red
} elseif ($avisos -gt 0) {
    Write-Host "  Pronto a usar, com $avisos aviso(s) acima (funcionalidades parciais)." -ForegroundColor Yellow
} else {
    Write-Host "  Tudo verificado. Abrir com 'Sensus AI Hub.lnk'." -ForegroundColor Green
}
Write-Host ""
