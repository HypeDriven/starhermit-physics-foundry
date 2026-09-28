// Strings for the Graphics settings section. The rest of the game is English;
// this panel follows the browser language (en-US, en-GB, es-419, es-ES, de-DE,
// fr-FR, fr-CA, pt-BR, it-IT; other locales fall back by language, then en-US).

const EN = {
  graphics: "Graphics",
  quality: "Quality",
  auto: "Auto (detected: {tier})",
  low: "Low", balanced: "Balanced", high: "High", ultra: "Ultra",
  renderScale: "Render scale",
  fromPreset: "From preset ({tier})",
  adaptive: "Adaptive resolution",
  showFps: "Show frame rate",
  postFailed: "Post-processing is unavailable on this device; the chamber renders without it.",
  unknownGpu: "unknown GPU",
  cat_shadows: "Shadows", cat_ao: "Ambient occlusion", cat_bloom: "Bloom", cat_grade: "Color grade",
  cat_antialias: "Anti-aliasing", cat_reflections: "Reflections", cat_particles: "Particles",
  cat_background: "Background motion", cat_detail: "Surface detail",
  t_off: "Off", t_on: "On", t_low: "Low", t_medium: "Medium", t_high: "High",
  t_fxaa: "FXAA", t_smaa: "SMAA", t_msaa: "MSAA",
  t_static: "Static", t_animated: "Animated", t_plain: "Plain", t_detailed: "Detailed",
  d_noShadows: "no shadows", d_shadows: "{n}² shadows", d_ao: "ambient occlusion", d_aoHigh: "full ambient occlusion",
  d_bloom: "bloom", d_reflections: "reflections", d_noAa: "no anti-aliasing",
};

const ES = {
  graphics: "Gráficos",
  quality: "Calidad",
  auto: "Automática (detectada: {tier})",
  low: "Baja", balanced: "Equilibrada", high: "Alta", ultra: "Ultra",
  renderScale: "Escala de renderizado",
  fromPreset: "Según preajuste ({tier})",
  adaptive: "Resolución adaptativa",
  showFps: "Mostrar fotogramas por segundo",
  postFailed: "El posprocesado no está disponible en este dispositivo; la cámara se dibuja sin él.",
  unknownGpu: "GPU desconocida",
  cat_shadows: "Sombras", cat_ao: "Oclusión ambiental", cat_bloom: "Resplandor", cat_grade: "Corrección de color",
  cat_antialias: "Suavizado", cat_reflections: "Reflejos", cat_particles: "Partículas",
  cat_background: "Movimiento de fondo", cat_detail: "Detalle de superficies",
  t_off: "Desactivado", t_on: "Activado", t_low: "Bajo", t_medium: "Medio", t_high: "Alto",
  t_fxaa: "FXAA", t_smaa: "SMAA", t_msaa: "MSAA",
  t_static: "Estático", t_animated: "Animado", t_plain: "Simple", t_detailed: "Detallado",
  d_noShadows: "sin sombras", d_shadows: "sombras {n}²", d_ao: "oclusión ambiental", d_aoHigh: "oclusión ambiental completa",
  d_bloom: "resplandor", d_reflections: "reflejos", d_noAa: "sin suavizado",
};

const DE = {
  graphics: "Grafik",
  quality: "Qualität",
  auto: "Automatisch (erkannt: {tier})",
  low: "Niedrig", balanced: "Ausgewogen", high: "Hoch", ultra: "Ultra",
  renderScale: "Renderskalierung",
  fromPreset: "Laut Voreinstellung ({tier})",
  adaptive: "Adaptive Auflösung",
  showFps: "Bildrate anzeigen",
  postFailed: "Nachbearbeitung ist auf diesem Gerät nicht verfügbar; die Kammer wird ohne sie dargestellt.",
  unknownGpu: "unbekannte GPU",
  cat_shadows: "Schatten", cat_ao: "Umgebungsverdeckung", cat_bloom: "Leuchten", cat_grade: "Farbkorrektur",
  cat_antialias: "Kantenglättung", cat_reflections: "Reflexionen", cat_particles: "Partikel",
  cat_background: "Hintergrundbewegung", cat_detail: "Oberflächendetails",
  t_off: "Aus", t_on: "An", t_low: "Niedrig", t_medium: "Mittel", t_high: "Hoch",
  t_fxaa: "FXAA", t_smaa: "SMAA", t_msaa: "MSAA",
  t_static: "Statisch", t_animated: "Animiert", t_plain: "Schlicht", t_detailed: "Detailliert",
  d_noShadows: "keine Schatten", d_shadows: "{n}²-Schatten", d_ao: "Umgebungsverdeckung", d_aoHigh: "volle Umgebungsverdeckung",
  d_bloom: "Leuchten", d_reflections: "Reflexionen", d_noAa: "keine Kantenglättung",
};

const FR = {
  graphics: "Graphismes",
  quality: "Qualité",
  auto: "Automatique (détectée : {tier})",
  low: "Basse", balanced: "Équilibrée", high: "Haute", ultra: "Ultra",
  renderScale: "Échelle de rendu",
  fromPreset: "Selon le préréglage ({tier})",
  adaptive: "Résolution adaptative",
  showFps: "Afficher la fréquence d’images",
  postFailed: "Le post-traitement n’est pas disponible sur cet appareil ; la chambre est affichée sans lui.",
  unknownGpu: "GPU inconnu",
  cat_shadows: "Ombres", cat_ao: "Occlusion ambiante", cat_bloom: "Halo lumineux", cat_grade: "Étalonnage des couleurs",
  cat_antialias: "Anticrénelage", cat_reflections: "Reflets", cat_particles: "Particules",
  cat_background: "Animation d’arrière-plan", cat_detail: "Détail des surfaces",
  t_off: "Désactivé", t_on: "Activé", t_low: "Bas", t_medium: "Moyen", t_high: "Élevé",
  t_fxaa: "FXAA", t_smaa: "SMAA", t_msaa: "MSAA",
  t_static: "Statique", t_animated: "Animé", t_plain: "Simple", t_detailed: "Détaillé",
  d_noShadows: "sans ombres", d_shadows: "ombres {n}²", d_ao: "occlusion ambiante", d_aoHigh: "occlusion ambiante complète",
  d_bloom: "halo", d_reflections: "reflets", d_noAa: "sans anticrénelage",
};

const PT = {
  graphics: "Gráficos",
  quality: "Qualidade",
  auto: "Automática (detectada: {tier})",
  low: "Baixa", balanced: "Equilibrada", high: "Alta", ultra: "Ultra",
  renderScale: "Escala de renderização",
  fromPreset: "Do predefinido ({tier})",
  adaptive: "Resolução adaptável",
  showFps: "Mostrar taxa de quadros",
  postFailed: "O pós-processamento não está disponível neste dispositivo; a câmara é exibida sem ele.",
  unknownGpu: "GPU desconhecida",
  cat_shadows: "Sombras", cat_ao: "Oclusão ambiente", cat_bloom: "Brilho", cat_grade: "Correção de cor",
  cat_antialias: "Antisserrilhado", cat_reflections: "Reflexos", cat_particles: "Partículas",
  cat_background: "Movimento de fundo", cat_detail: "Detalhe das superfícies",
  t_off: "Desligado", t_on: "Ligado", t_low: "Baixo", t_medium: "Médio", t_high: "Alto",
  t_fxaa: "FXAA", t_smaa: "SMAA", t_msaa: "MSAA",
  t_static: "Estático", t_animated: "Animado", t_plain: "Simples", t_detailed: "Detalhado",
  d_noShadows: "sem sombras", d_shadows: "sombras {n}²", d_ao: "oclusão ambiente", d_aoHigh: "oclusão ambiente completa",
  d_bloom: "brilho", d_reflections: "reflexos", d_noAa: "sem antisserrilhado",
};

const IT = {
  graphics: "Grafica",
  quality: "Qualità",
  auto: "Automatica (rilevata: {tier})",
  low: "Bassa", balanced: "Bilanciata", high: "Alta", ultra: "Ultra",
  renderScale: "Scala di rendering",
  fromPreset: "Da preimpostazione ({tier})",
  adaptive: "Risoluzione adattiva",
  showFps: "Mostra frequenza fotogrammi",
  postFailed: "La post-elaborazione non è disponibile su questo dispositivo; la camera viene mostrata senza.",
  unknownGpu: "GPU sconosciuta",
  cat_shadows: "Ombre", cat_ao: "Occlusione ambientale", cat_bloom: "Bagliore", cat_grade: "Correzione colore",
  cat_antialias: "Antialiasing", cat_reflections: "Riflessi", cat_particles: "Particelle",
  cat_background: "Movimento di sfondo", cat_detail: "Dettaglio superfici",
  t_off: "Disattivato", t_on: "Attivo", t_low: "Basso", t_medium: "Medio", t_high: "Alto",
  t_fxaa: "FXAA", t_smaa: "SMAA", t_msaa: "MSAA",
  t_static: "Statico", t_animated: "Animato", t_plain: "Semplice", t_detailed: "Dettagliato",
  d_noShadows: "nessuna ombra", d_shadows: "ombre {n}²", d_ao: "occlusione ambientale", d_aoHigh: "occlusione ambientale completa",
  d_bloom: "bagliore", d_reflections: "riflessi", d_noAa: "nessun antialiasing",
};

export const LOCALES = {
  "en-US": EN,
  "en-GB": { ...EN, cat_grade: "Colour grade" },
  "es-419": ES,
  "es-ES": { ...ES, showFps: "Mostrar imágenes por segundo" },
  "de-DE": DE,
  "fr-FR": FR,
  "fr-CA": { ...FR, showFps: "Afficher la fréquence d’affichage", cat_bloom: "Éclat lumineux" },
  "pt-BR": { ...PT, postFailed: "O pós-processamento não está disponível neste dispositivo; a câmera é exibida sem ele." },
  "it-IT": IT,
};

const BY_LANG = { en: "en-US", es: "es-419", de: "de-DE", fr: "fr-FR", pt: "pt-BR", it: "it-IT" };

export function pickLocale(lang) {
  const l = String(lang || "en-US");
  if (LOCALES[l]) return l;
  const lower = l.toLowerCase();
  for (const k of Object.keys(LOCALES)) if (k.toLowerCase() === lower) return k;
  if (/^es-es$/i.test(l)) return "es-ES";
  if (/^en-(gb|au|nz|ie|in|za)$/i.test(l)) return "en-GB";
  if (/^fr-ca$/i.test(l)) return "fr-CA";
  return BY_LANG[lower.split("-")[0]] || "en-US";
}

/** Translator for a locale: t(key, {vars}). Missing keys fall back to English. */
export function translator(lang) {
  const table = LOCALES[pickLocale(lang)];
  return (key, vars) => {
    let s = table[key] ?? EN[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace("{" + k + "}", v);
    return s;
  };
}

/** Localized cost summary (same parts as gfx.describe). */
export function describeLocalized(t, r, shadowMap, pixels) {
  const parts = [
    r.shadows === "off" ? t("d_noShadows") : t("d_shadows", { n: shadowMap[r.shadows] }),
    r.ao === "off" ? null : r.ao === "high" ? t("d_aoHigh") : t("d_ao"),
    r.bloom === "on" ? t("d_bloom") : null,
    r.reflections === "on" ? t("d_reflections") : null,
    r.antialias === "off" ? t("d_noAa") : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
