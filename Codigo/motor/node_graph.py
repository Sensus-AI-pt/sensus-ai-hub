"""Motor de avaliação do grafo de nodes do Ambiente Virtual (ver spec em
docs/superpowers/specs/2026-07-27-node-graph-sen-format-design.md).

Módulo puro: não importa nada do engine_sensus_unificado.py. Recebe um grafo
(dict serializado do frontend) e um `context` (valores de sensores desta
frame) e devolve os valores finais dos nodes de output, agrupados por papel
(role). Estado entre frames (ex.: suavização temporal do node `smooth`) fica
em `GraphState`, criado uma vez por grafo carregado e descartado quando um
grafo novo é recebido.
"""

import math

import cv2
import numpy as np


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _as_float(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _kelvin_to_rgb(kelvin):
    """Tanner Helland, 'How to Convert Temperature (K) to RGB', 2012 —
    aproximação por regressão sobre a tabela de radiação de corpo negro,
    heurística de conversão de cor amplamente usada em software de imagem,
    não um modelo físico exato."""
    temp = _clamp(kelvin, 1000, 40000) / 100.0
    if temp <= 66:
        red = 255
    else:
        red = 329.698727446 * ((temp - 60) ** -0.1332047592)
    if temp <= 66:
        green = 99.4708025861 * math.log(temp) - 161.1195681661
    else:
        green = 288.1221695283 * ((temp - 60) ** -0.0755148492)
    if temp >= 66:
        blue = 255
    elif temp <= 19:
        blue = 0
    else:
        blue = 138.5177312231 * math.log(temp - 10) - 305.0447927307
    r = int(_clamp(red, 0, 255))
    g = int(_clamp(green, 0, 255))
    b = int(_clamp(blue, 0, 255))
    return "#{:02x}{:02x}{:02x}".format(r, g, b)


# ── Avaliadores de cada tipo de node ──
# Assinatura comum: eval(params, inputs, node_state, context) -> dict de
# valores de output. Nodes "de papel" (prompt_fragment, sd_params,
# depth_viz_output, layer_control, music_modifiers) não alimentam outros
# nodes — devolvem "_role" + os campos resolvidos, recolhidos em `evaluate()`.

def _eval_sensor(params, inputs, state, context):
    field = params.get("field", "")
    return {"out": _as_float(context.get(field), 0.0)}

def _eval_number(params, inputs, state, context):
    return {"out": _as_float(params.get("value"), 0.0)}

def _eval_bool(params, inputs, state, context):
    return {"out": bool(params.get("value", False))}

def _eval_color(params, inputs, state, context):
    return {"out": params.get("value", "#ffffff")}

def _eval_add(params, inputs, state, context):
    return {"out": _as_float(inputs.get("a")) + _as_float(inputs.get("b"))}

def _eval_sub(params, inputs, state, context):
    return {"out": _as_float(inputs.get("a")) - _as_float(inputs.get("b"))}

def _eval_mul(params, inputs, state, context):
    return {"out": _as_float(inputs.get("a")) * _as_float(inputs.get("b"))}

def _eval_div(params, inputs, state, context):
    b = _as_float(inputs.get("b"))
    return {"out": (_as_float(inputs.get("a")) / b) if b != 0 else 0.0}

def _eval_map_range(params, inputs, state, context):
    in_min = _as_float(params.get("inMin"), 0.0)
    in_max = _as_float(params.get("inMax"), 1.0)
    out_min = _as_float(params.get("outMin"), 0.0)
    out_max = _as_float(params.get("outMax"), 1.0)
    lo, hi = min(in_min, in_max), max(in_min, in_max)
    v = _clamp(_as_float(inputs.get("in")), lo, hi)
    span_in = (in_max - in_min) or 1e-9
    t = (v - in_min) / span_in
    return {"out": out_min + t * (out_max - out_min)}

def _eval_clamp(params, inputs, state, context):
    lo = _as_float(params.get("min"), 0.0)
    hi = _as_float(params.get("max"), 1.0)
    return {"out": _clamp(_as_float(inputs.get("in")), lo, hi)}

def _eval_smooth(params, inputs, state, context):
    factor = _clamp(_as_float(params.get("factor"), 0.2), 0.01, 1.0)
    target = _as_float(inputs.get("in"))
    prev = state.get("value", 0.0)
    value = prev + (target - prev) * factor
    state["value"] = value
    return {"out": value}

_COMPARE_OPS = {
    ">": lambda a, b: a > b, "<": lambda a, b: a < b,
    ">=": lambda a, b: a >= b, "<=": lambda a, b: a <= b,
    "==": lambda a, b: a == b,
}

def _eval_compare(params, inputs, state, context):
    op = _COMPARE_OPS.get(params.get("op", ">"), _COMPARE_OPS[">"])
    return {"out": bool(op(_as_float(inputs.get("a")), _as_float(inputs.get("b"))))}

def _eval_and(params, inputs, state, context):
    return {"out": bool(inputs.get("a")) and bool(inputs.get("b"))}

def _eval_or(params, inputs, state, context):
    return {"out": bool(inputs.get("a")) or bool(inputs.get("b"))}

def _eval_not(params, inputs, state, context):
    return {"out": not bool(inputs.get("a"))}

def _eval_threshold(params, inputs, state, context):
    t = _as_float(params.get("threshold"), 0.5)
    return {"out": _as_float(inputs.get("in")) > t}

def _eval_color_temperature(params, inputs, state, context):
    kelvin = inputs.get("kelvin")
    kelvin = _as_float(kelvin if kelvin is not None else params.get("kelvin"), 6500.0)
    return {"out": _kelvin_to_rgb(kelvin)}

def _eval_prompt_fragment(params, inputs, state, context):
    template = params.get("template", "{value}")
    value = inputs.get("value", "")
    try:
        text = template.format(value=value)
    except Exception:
        text = template
    return {"_role": "prompt_fragment", "_text": text}

def _eval_sd_params(params, inputs, state, context):
    def pick(key, lo, hi, default):
        v = inputs.get(key)
        if v is None:
            v = params.get(key, default)
        return _clamp(_as_float(v, default), lo, hi)
    return {
        "_role": "sd_params",
        "_cfg": pick("cfg", 1.0, 15.0, 1.0),
        "_denoising": pick("denoising", 0.10, 0.95, 0.65),
        "_steps": int(_clamp(_as_float(inputs.get("steps", params.get("steps", 1)), 1), 1, 2)),
        "_seed": int(_as_float(inputs.get("seed", params.get("seed", 0)), 0)),
    }

_DEPTH_TECHNIQUES = {
    "point_cloud", "wireframe", "particles", "instanced_cubes",
    "topographic_laser", "relighting", "z_masking",
}

# Portas de entrada do depth_viz_output, na mesma ordem do NODE_TYPES lá em baixo.
_DEPTH_VIZ_INPUTS = ("amplitude", "contrast", "threshold", "baseColor",
                     "pointSize", "resolution", "waveSize", "waveSpeed",
                     "glow", "slices")

def _eval_depth_viz_output(params, inputs, state, context):
    def pick(key, default):
        v = inputs.get(key)
        return v if v is not None else params.get(key, default)
    technique = params.get("technique", "point_cloud")
    if technique not in _DEPTH_TECHNIQUES:
        technique = "point_cloud"
    # Chaves que vieram mesmo de uma ligação, e não dos params deste node. Quem
    # consome distingue "o grafo decidiu isto" de "ficou no valor por omissão" —
    # sem isto, pôr um depth_viz no grafo desligava o painel manual inteiro.
    driven = [k for k in _DEPTH_VIZ_INPUTS if inputs.get(k) is not None]
    return {
        "_role": "depth_viz",
        "_driven": driven,
        "_technique": technique,
        "_amplitude": _as_float(pick("amplitude", 3.0)),
        "_contrast": _as_float(pick("contrast", 1.5)),
        "_threshold": _as_float(pick("threshold", 0.05)),
        "_colorMode": params.get("colorMode", "Rainbow"),
        "_baseColor": pick("baseColor", "#00f0ff"),
        "_pointSize": _as_float(pick("pointSize", 3.0)),
        "_resolution": int(_as_float(pick("resolution", 256))),
        "_waveSize": _as_float(pick("waveSize", 0.0)),
        "_waveSpeed": _as_float(pick("waveSpeed", 1.0)),
        "_glow": _as_float(pick("glow", 0.8)),
        "_slices": int(_as_float(pick("slices", 0))),
    }

_VALID_LAYERS = {"melodia", "piano", "coro", "tabla", "percussao"}

def _eval_layer_control(params, inputs, state, context):
    layer = params.get("layer", "melodia")
    if layer not in _VALID_LAYERS:
        layer = "melodia"
    vol_in = inputs.get("volume")
    vol = _clamp(_as_float(vol_in if vol_in is not None else params.get("volume", 0.6)), 0.0, 1.0)
    mute_in = inputs.get("mute")
    on = (not bool(mute_in)) if mute_in is not None else bool(params.get("on", True))
    return {"_role": "layer_control", "_layer": layer, "_volume": vol, "_on": on}

def _eval_music_modifiers(params, inputs, state, context):
    tempo_in = inputs.get("tempoMult")
    cutoff_in = inputs.get("cutoffMult")
    return {
        "_role": "music_modifiers",
        "_scale": params.get("scale") or None,
        "_bpmMult": _clamp(_as_float(tempo_in if tempo_in is not None else params.get("tempoMult", 1.0)), 0.5, 1.5),
        "_cutoffMult": _clamp(_as_float(cutoff_in if cutoff_in is not None else params.get("cutoffMult", 1.0)), 0.3, 1.5),
    }

def _eval_camera_image(params, inputs, state, context):
    return {"out": context.get("camera_image")}

def _eval_depth_map_image(params, inputs, state, context):
    return {"out": context.get("depth_map_image")}

def _eval_generated_image(params, inputs, state, context):
    return {"out": context.get("generated_image")}

def _eval_blur(params, inputs, state, context):
    img = inputs.get("image")
    if img is None:
        return {"out": None}
    radius = int(_clamp(_as_float(params.get("radius"), 5), 1, 50))
    k = radius * 2 + 1
    return {"out": cv2.GaussianBlur(img, (k, k), 0)}

def _eval_brightness_contrast(params, inputs, state, context):
    img = inputs.get("image")
    if img is None:
        return {"out": None}
    brightness = _clamp(_as_float(params.get("brightness"), 0.0), -100, 100)
    contrast = _clamp(_as_float(params.get("contrast"), 0.0), -100, 100)
    alpha = 1.0 + contrast / 100.0
    return {"out": cv2.convertScaleAbs(img, alpha=alpha, beta=brightness)}

def _eval_hsv_adjust(params, inputs, state, context):
    img = inputs.get("image")
    if img is None:
        return {"out": None}
    hue_shift = _clamp(_as_float(params.get("hueShift"), 0.0), -180, 180)
    sat_mult = _clamp(_as_float(params.get("saturation"), 1.0), 0.0, 3.0)
    val_mult = _clamp(_as_float(params.get("value"), 1.0), 0.0, 3.0)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 0] = (hsv[..., 0] + hue_shift / 2.0) % 180.0  # matiz do OpenCV é 0-179
    hsv[..., 1] = np.clip(hsv[..., 1] * sat_mult, 0, 255)
    hsv[..., 2] = np.clip(hsv[..., 2] * val_mult, 0, 255)
    return {"out": cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)}

def _eval_img_threshold(params, inputs, state, context):
    img = inputs.get("image")
    if img is None:
        return {"out": None}
    t = int(_clamp(_as_float(params.get("threshold"), 128), 0, 255))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, t, 255, cv2.THRESH_BINARY)
    return {"out": cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)}

def _eval_edge(params, inputs, state, context):
    img = inputs.get("image")
    if img is None:
        return {"out": None}
    t1 = _clamp(_as_float(params.get("threshold1"), 100), 0, 500)
    t2 = _clamp(_as_float(params.get("threshold2"), 200), 0, 500)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, int(t1), int(t2))
    return {"out": cv2.cvtColor(edges, cv2.COLOR_GRAY2BGR)}

def _eval_composite(params, inputs, state, context):
    a = inputs.get("a")
    b = inputs.get("b")
    if a is None:
        return {"out": b}
    if b is None:
        return {"out": a}
    if a.shape != b.shape:
        b = cv2.resize(b, (a.shape[1], a.shape[0]))
    mode = params.get("mode", "mix")
    mix = _clamp(_as_float(params.get("mix"), 0.5), 0.0, 1.0)
    af, bf = a.astype(np.float32), b.astype(np.float32)
    if mode == "add":
        out = af + bf
    elif mode == "multiply":
        out = (af * bf) / 255.0
    elif mode == "screen":
        out = 255.0 - ((255.0 - af) * (255.0 - bf)) / 255.0
    else:
        out = af * (1.0 - mix) + bf * mix
    return {"out": np.clip(out, 0, 255).astype(np.uint8)}

def _eval_chroma_key(params, inputs, state, context):
    img = inputs.get("image")
    if img is None:
        return {"out": None}
    key_hex = (params.get("keyColor") or "#00ff00").lstrip("#")
    tolerance = _clamp(_as_float(params.get("tolerance"), 30), 0, 100)
    key_rgb = tuple(int(key_hex[i:i + 2], 16) for i in (0, 2, 4))
    key_bgr = np.uint8([[[key_rgb[2], key_rgb[1], key_rgb[0]]]])
    hsv_img = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    hsv_key = cv2.cvtColor(key_bgr, cv2.COLOR_BGR2HSV)[0][0]
    tol = int(tolerance * 1.8)  # 0..100 -> faixa de matiz 0..180
    lower = np.array([max(0, int(hsv_key[0]) - tol), 40, 40])
    upper = np.array([min(179, int(hsv_key[0]) + tol), 255, 255])
    mask = cv2.inRange(hsv_img, lower, upper)
    out = img.copy()
    out[mask > 0] = 0
    return {"out": out}

def _eval_feedback_image(params, inputs, state, context):
    img = inputs.get("image")
    if img is None:
        return {"out": state.get("last")}
    mix_factor = _clamp(_as_float(params.get("mixFactor"), 0.5), 0.0, 1.0)
    last = state.get("last")
    out = img if last is None or last.shape != img.shape else cv2.addWeighted(img, 1.0 - mix_factor, last, mix_factor, 0)
    state["last"] = out
    return {"out": out}

def _eval_image_output(params, inputs, state, context):
    target = params.get("target", "sd_input")
    if target not in ("sd_input", "sd_output", "depth_map"):
        target = "sd_input"
    return {"_role": "image_output", "_target": target, "_image": inputs.get("image")}

def _eval_noise(params, inputs, state, context):
    t = _as_float(context.get("time"), 0.0)
    x = t * _as_float(params.get("speed"), 1.0) + _as_float(params.get("seed"), 0.0)
    # Ruído suave determinístico (soma de senos com frequências incomensuráveis) —
    # não é Perlin real, evita só repetição óbvia sem dependências novas.
    val = (math.sin(x) + math.sin(x * 2.17 + 1.3) * 0.5 + math.sin(x * 4.33 + 2.7) * 0.25) / 1.75
    return {"out": val}

def _eval_wave(params, inputs, state, context):
    t = _as_float(context.get("time"), 0.0)
    shape = params.get("shape", "sine")
    freq = _as_float(params.get("frequency"), 1.0)
    amp = _as_float(params.get("amplitude"), 1.0)
    phase = (t * freq) % 1.0
    if shape == "square":
        val = 1.0 if phase < 0.5 else -1.0
    elif shape == "saw":
        val = 2.0 * phase - 1.0
    else:
        val = math.sin(phase * 2 * math.pi)
    return {"out": val * amp}

def _eval_trigger(params, inputs, state, context):
    threshold = _as_float(params.get("threshold"), 0.5)
    above = _as_float(inputs.get("in")) > threshold
    was_above = state.get("was_above", False)
    state["was_above"] = above
    return {"out": bool(above and not was_above)}

def _eval_envelope(params, inputs, state, context):
    t = _as_float(context.get("time"), 0.0)
    attack = max(0.001, _as_float(params.get("attack"), 0.1))
    decay = max(0.001, _as_float(params.get("decay"), 0.2))
    sustain = _clamp(_as_float(params.get("sustain"), 0.7), 0.0, 1.0)
    release = max(0.001, _as_float(params.get("release"), 0.3))
    triggered = bool(inputs.get("trigger"))
    phase = state.get("phase", "idle")
    phase_start = state.get("phase_start", t)
    last_val = state.get("last_val", 0.0)

    if triggered and phase in ("idle", "release"):
        phase, phase_start = "attack", t
    elif not triggered and phase in ("attack", "decay", "sustain"):
        state["release_start_val"] = last_val
        phase, phase_start = "release", t

    elapsed = t - phase_start
    if phase == "attack":
        val = min(1.0, elapsed / attack)
        if val >= 1.0:
            phase, phase_start = "decay", t
    elif phase == "decay":
        val = 1.0 - (1.0 - sustain) * min(1.0, elapsed / decay)
        if elapsed >= decay:
            phase, val = "sustain", sustain
    elif phase == "sustain":
        val = sustain
    elif phase == "release":
        start_val = state.get("release_start_val", sustain)
        val = start_val * max(0.0, 1.0 - elapsed / release)
        if elapsed >= release:
            phase, val = "idle", 0.0
    else:
        val = 0.0

    state["phase"], state["phase_start"], state["last_val"] = phase, phase_start, val
    return {"out": val}

def _eval_delay(params, inputs, state, context):
    t = _as_float(context.get("time"), 0.0)
    seconds = max(0.0, _as_float(params.get("seconds"), 0.5))
    v = _as_float(inputs.get("in"))
    buf = state.setdefault("buf", [])
    buf.append((t, v))
    cutoff = t - seconds - 10.0
    while buf and buf[0][0] < cutoff:
        buf.pop(0)
    target_t = t - seconds
    best = v
    for (bt, bv) in buf:
        if bt <= target_t:
            best = bv
        else:
            break
    return {"out": best}

def _eval_hold(params, inputs, state, context):
    if bool(inputs.get("trigger")):
        state["value"] = _as_float(inputs.get("in"))
    return {"out": state.get("value", 0.0)}

def _eval_select(params, inputs, state, context):
    idx = int(_clamp(_as_float(params.get("index"), 0), 0, 2))
    return {"out": _as_float(inputs.get(["in0", "in1", "in2"][idx]))}

def _eval_switch(params, inputs, state, context):
    cond = bool(inputs.get("cond"))
    return {"out": _as_float(inputs.get("a")) if cond else _as_float(inputs.get("b"))}

def _eval_average(params, inputs, state, context):
    vals = [_as_float(inputs.get(k)) for k in ("a", "b", "c")]
    return {"out": sum(vals) / len(vals)}

def _eval_audio_spectrum(params, inputs, state, context):
    return {
        "bass": _as_float(context.get("audio_bass"), 0.0),
        "mid": _as_float(context.get("audio_mid"), 0.0),
        "treble": _as_float(context.get("audio_treble"), 0.0),
    }

def _pick(inputs, params, key, default):
    v = inputs.get(key)
    return v if v is not None else params.get(key, default)

def _eval_transform_3d(params, inputs, state, context):
    return {
        "_role": "transform_3d",
        "_posX": _as_float(_pick(inputs, params, "posX", 0.0)), "_posY": _as_float(_pick(inputs, params, "posY", 0.0)), "_posZ": _as_float(_pick(inputs, params, "posZ", 0.0)),
        "_rotX": _as_float(_pick(inputs, params, "rotX", 0.0)), "_rotY": _as_float(_pick(inputs, params, "rotY", 0.0)), "_rotZ": _as_float(_pick(inputs, params, "rotZ", 0.0)),
        "_scale": _as_float(_pick(inputs, params, "scale", 1.0)),
    }

def _eval_camera_3d(params, inputs, state, context):
    return {
        "_role": "camera_3d",
        "_fov": _as_float(_pick(inputs, params, "fov", 50.0)),
        "_distance": _as_float(_pick(inputs, params, "distance", 12.0)),
        "_autoOrbit": bool(_pick(inputs, params, "autoOrbit", True)),
    }

def _eval_light_3d(params, inputs, state, context):
    return {
        "_role": "light_3d",
        "_intensity": _as_float(_pick(inputs, params, "intensity", 0.5)),
        "_color": _pick(inputs, params, "color", "#ffffff"),
    }


NODE_TYPES = {
    "sensor":        {"inputs": {}, "outputs": {"out": "float"}, "eval": _eval_sensor},
    "number":        {"inputs": {}, "outputs": {"out": "float"}, "eval": _eval_number},
    "bool":          {"inputs": {}, "outputs": {"out": "bool"}, "eval": _eval_bool},
    "color":         {"inputs": {}, "outputs": {"out": "color"}, "eval": _eval_color},
    "add":           {"inputs": {"a": "float", "b": "float"}, "outputs": {"out": "float"}, "eval": _eval_add},
    "sub":           {"inputs": {"a": "float", "b": "float"}, "outputs": {"out": "float"}, "eval": _eval_sub},
    "mul":           {"inputs": {"a": "float", "b": "float"}, "outputs": {"out": "float"}, "eval": _eval_mul},
    "div":           {"inputs": {"a": "float", "b": "float"}, "outputs": {"out": "float"}, "eval": _eval_div},
    "map_range":     {"inputs": {"in": "float"}, "outputs": {"out": "float"}, "eval": _eval_map_range},
    "clamp":         {"inputs": {"in": "float"}, "outputs": {"out": "float"}, "eval": _eval_clamp},
    "smooth":        {"inputs": {"in": "float"}, "outputs": {"out": "float"}, "eval": _eval_smooth},
    "compare":       {"inputs": {"a": "float", "b": "float"}, "outputs": {"out": "bool"}, "eval": _eval_compare},
    "and":           {"inputs": {"a": "bool", "b": "bool"}, "outputs": {"out": "bool"}, "eval": _eval_and},
    "or":            {"inputs": {"a": "bool", "b": "bool"}, "outputs": {"out": "bool"}, "eval": _eval_or},
    "not":           {"inputs": {"a": "bool"}, "outputs": {"out": "bool"}, "eval": _eval_not},
    "threshold":     {"inputs": {"in": "float"}, "outputs": {"out": "bool"}, "eval": _eval_threshold},
    "color_temperature": {"inputs": {"kelvin": "float"}, "outputs": {"out": "color"}, "eval": _eval_color_temperature},
    "prompt_fragment":   {"inputs": {"value": "float"}, "outputs": {}, "eval": _eval_prompt_fragment},
    "sd_params":         {"inputs": {"cfg": "float", "denoising": "float", "steps": "float", "seed": "float"}, "outputs": {}, "eval": _eval_sd_params},
    "depth_viz_output":  {"inputs": {"amplitude": "float", "contrast": "float", "threshold": "float", "baseColor": "color", "pointSize": "float", "resolution": "float", "waveSize": "float", "waveSpeed": "float", "glow": "float", "slices": "float"}, "outputs": {}, "eval": _eval_depth_viz_output},
    "layer_control":     {"inputs": {"volume": "float", "mute": "bool"}, "outputs": {}, "eval": _eval_layer_control},
    "music_modifiers":   {"inputs": {"tempoMult": "float", "cutoffMult": "float"}, "outputs": {}, "eval": _eval_music_modifiers},

    "camera_image":      {"inputs": {}, "outputs": {"out": "image"}, "eval": _eval_camera_image},
    "depth_map_image":   {"inputs": {}, "outputs": {"out": "image"}, "eval": _eval_depth_map_image},
    "generated_image":   {"inputs": {}, "outputs": {"out": "image"}, "eval": _eval_generated_image},
    "blur":              {"inputs": {"image": "image"}, "outputs": {"out": "image"}, "eval": _eval_blur},
    "brightness_contrast": {"inputs": {"image": "image"}, "outputs": {"out": "image"}, "eval": _eval_brightness_contrast},
    "hsv_adjust":        {"inputs": {"image": "image"}, "outputs": {"out": "image"}, "eval": _eval_hsv_adjust},
    "img_threshold":     {"inputs": {"image": "image"}, "outputs": {"out": "image"}, "eval": _eval_img_threshold},
    "edge":              {"inputs": {"image": "image"}, "outputs": {"out": "image"}, "eval": _eval_edge},
    "composite":         {"inputs": {"a": "image", "b": "image"}, "outputs": {"out": "image"}, "eval": _eval_composite},
    "chroma_key":        {"inputs": {"image": "image"}, "outputs": {"out": "image"}, "eval": _eval_chroma_key},
    "feedback_image":    {"inputs": {"image": "image"}, "outputs": {"out": "image"}, "eval": _eval_feedback_image},
    "image_output":      {"inputs": {"image": "image"}, "outputs": {}, "eval": _eval_image_output},

    "noise":             {"inputs": {}, "outputs": {"out": "float"}, "eval": _eval_noise},
    "wave":              {"inputs": {}, "outputs": {"out": "float"}, "eval": _eval_wave},
    "trigger":           {"inputs": {"in": "float"}, "outputs": {"out": "bool"}, "eval": _eval_trigger},
    "envelope":          {"inputs": {"trigger": "bool"}, "outputs": {"out": "float"}, "eval": _eval_envelope},
    "delay":             {"inputs": {"in": "float"}, "outputs": {"out": "float"}, "eval": _eval_delay},
    "hold":              {"inputs": {"in": "float", "trigger": "bool"}, "outputs": {"out": "float"}, "eval": _eval_hold},
    "select":            {"inputs": {"in0": "float", "in1": "float", "in2": "float"}, "outputs": {"out": "float"}, "eval": _eval_select},
    "switch":            {"inputs": {"cond": "bool", "a": "float", "b": "float"}, "outputs": {"out": "float"}, "eval": _eval_switch},
    "average":           {"inputs": {"a": "float", "b": "float", "c": "float"}, "outputs": {"out": "float"}, "eval": _eval_average},
    "audio_spectrum":    {"inputs": {}, "outputs": {"bass": "float", "mid": "float", "treble": "float"}, "eval": _eval_audio_spectrum},

    "transform_3d":      {"inputs": {"posX": "float", "posY": "float", "posZ": "float", "rotX": "float", "rotY": "float", "rotZ": "float", "scale": "float"}, "outputs": {}, "eval": _eval_transform_3d},
    "camera_3d":         {"inputs": {"fov": "float", "distance": "float", "autoOrbit": "bool"}, "outputs": {}, "eval": _eval_camera_3d},
    "light_3d":          {"inputs": {"intensity": "float", "color": "color"}, "outputs": {}, "eval": _eval_light_3d},
}


class GraphError(Exception):
    pass


def _topological_order(nodes, connections):
    node_ids = [n["id"] for n in nodes]
    deps = {nid: set() for nid in node_ids}
    for conn in connections:
        src_id = conn["from"][0]
        dst_id = conn["to"][0]
        if dst_id not in deps or src_id not in deps:
            raise GraphError(f"Ligação refere-se a um node inexistente: {conn}")
        deps[dst_id].add(src_id)

    ordered = []
    visited = set()
    visiting = set()

    def visit(nid):
        if nid in visited:
            return
        if nid in visiting:
            raise GraphError(f"Ciclo detetado no grafo (node '{nid}')")
        visiting.add(nid)
        for dep in deps[nid]:
            visit(dep)
        visiting.discard(nid)
        visited.add(nid)
        ordered.append(nid)

    for nid in node_ids:
        visit(nid)
    return ordered


class GraphState:
    """Estado por-node persistido entre frames (ex.: `smooth`). Cria-se uma
    instância nova sempre que um grafo novo é recebido (SET_GRAPH/
    LOAD_EXHIBITION) — descarta estado de suavização do grafo anterior."""

    def __init__(self):
        self._node_state = {}

    def for_node(self, node_id):
        return self._node_state.setdefault(node_id, {})


def validate_graph(graph):
    """Levanta GraphError se o grafo for inválido (node/porta desconhecidos,
    ligação para node inexistente, ciclo). Não avalia nada — só estrutura."""
    nodes = graph.get("nodes", [])
    connections = graph.get("connections", [])
    ids = set()
    for n in nodes:
        if n["type"] not in NODE_TYPES:
            raise GraphError(f"Tipo de node desconhecido: {n['type']}")
        if n["id"] in ids:
            raise GraphError(f"Id de node duplicado: {n['id']}")
        ids.add(n["id"])
    for c in connections:
        src_id, _src_port = c["from"]
        dst_id, _dst_port = c["to"]
        if src_id not in ids or dst_id not in ids:
            raise GraphError(f"Ligação refere-se a um node inexistente: {c}")
    _topological_order(nodes, connections)
    return True


def evaluate(graph, context, state):
    """Avalia o grafo inteiro para uma frame.

    graph: {"nodes": [...], "connections": [...]}
    context: dict plano de valores de sensores desta frame (ex. {"bpm": 72.0,
        "val": 0.12, "russell.positivo": 0.4, ...})
    state: instância de GraphState (persistida pelo chamador entre frames)

    Devolve (outputs, error). Em sucesso, error é None e outputs tem a forma:
        {"prompt_fragments": [str], "sd_params": dict|None, "depth_viz":
         dict|None, "layer_control": [dict], "music_modifiers": dict|None}
    Em erro, outputs é None e error é uma mensagem — nunca propaga exceção.
    """
    nodes = graph.get("nodes", [])
    connections = graph.get("connections", [])
    try:
        validate_graph(graph)
        order = _topological_order(nodes, connections)
    except GraphError as ex:
        return None, str(ex)

    nodes_by_id = {n["id"]: n for n in nodes}
    incoming = {}
    for c in connections:
        incoming[(c["to"][0], c["to"][1])] = (c["from"][0], c["from"][1])

    values = {}
    result = {
        "prompt_fragments": [], "sd_params": None, "depth_viz": None,
        "depth_viz_driven": [],
        "layer_control": [], "music_modifiers": None,
        "image_output": [], "transform_3d": None, "camera_3d": None, "light_3d": None,
    }

    for node_id in order:
        node = nodes_by_id[node_id]
        spec = NODE_TYPES[node["type"]]
        params = node.get("params", {})
        resolved_inputs = {}
        for port in spec["inputs"]:
            src = incoming.get((node_id, port))
            resolved_inputs[port] = values.get(src) if src is not None else params.get(port)
        try:
            out = spec["eval"](params, resolved_inputs, state.for_node(node_id), context)
        except Exception as ex:
            return None, f"Falha a avaliar node '{node_id}' ({node['type']}): {ex}"

        for port in spec["outputs"]:
            values[(node_id, port)] = out.get(port)

        role = out.get("_role")
        if role == "prompt_fragment":
            result["prompt_fragments"].append(out["_text"])
        elif role == "sd_params":
            result["sd_params"] = {
                "cfg": out["_cfg"], "denoising": out["_denoising"],
                "steps": out["_steps"], "seed": out["_seed"],
            }
        elif role == "depth_viz":
            result["depth_viz"] = {k[1:]: v for k, v in out.items()
                                   if k.startswith("_") and k not in ("_role", "_driven")}
            result["depth_viz_driven"] = out["_driven"]
        elif role == "layer_control":
            result["layer_control"].append({"layer": out["_layer"], "volume": out["_volume"], "on": out["_on"]})
        elif role == "music_modifiers":
            result["music_modifiers"] = {
                "scale": out["_scale"], "bpmMult": out["_bpmMult"], "cutoffMult": out["_cutoffMult"],
            }
        elif role == "image_output":
            result["image_output"].append({"target": out["_target"], "image": out["_image"]})
        elif role == "transform_3d":
            result["transform_3d"] = {
                "posX": out["_posX"], "posY": out["_posY"], "posZ": out["_posZ"],
                "rotX": out["_rotX"], "rotY": out["_rotY"], "rotZ": out["_rotZ"], "scale": out["_scale"],
            }
        elif role == "camera_3d":
            result["camera_3d"] = {"fov": out["_fov"], "distance": out["_distance"], "autoOrbit": out["_autoOrbit"]}
        elif role == "light_3d":
            result["light_3d"] = {"intensity": out["_intensity"], "color": out["_color"]}

    return result, None
