from .controlnet_export import SDXLControlNetExportWrapper
from .unet_controlnet_export import ControlNetUNetExportWrapper, MultiControlNetUNetExportWrapper
from .unet_sdxl_export import SDXLExportWrapper, SDXLConditioningHandler
from .unet_unified_export import UnifiedExportWrapper

# O wrapper de IP-Adapter depende de `diffusers_ipadapter`, um pacote externo que
# este projeto não usa nem instala. Importá-lo aqui de forma incondicional fazia
# a compilação dos motores TensorRT falhar por inteiro — mesmo no caminho img2img
# simples, que nunca lhe toca. Fica opcional: quem precisar de IP-Adapter instala
# o pacote e o nome passa a existir; quem não precisar compila na mesma.
try:
    from .unet_ipadapter_export import IPAdapterUNetExportWrapper
except ImportError:  # pragma: no cover — depende de um extra não instalado
    IPAdapterUNetExportWrapper = None

__all__ = [
    "SDXLControlNetExportWrapper",
    "ControlNetUNetExportWrapper",
    "MultiControlNetUNetExportWrapper",
    "IPAdapterUNetExportWrapper",
    "SDXLExportWrapper",
    "SDXLConditioningHandler",
    "UnifiedExportWrapper",
]
