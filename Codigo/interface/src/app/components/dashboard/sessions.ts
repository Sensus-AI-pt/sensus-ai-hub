// Gestão de contadores de sessão do Sensus AI Hub.
// - Total acumulado (sensus-sessions-count)
// - Contador diário com reset automático à meia-noite (sensus-sessions-today)

const TOTAL_KEY = "sensus-sessions-count";
const TODAY_KEY = "sensus-sessions-today";
const DATE_KEY = "sensus-sessions-date";
const BY_DAY_KEY = "sensus-sessions-by-day"; // { "YYYY-MM-DD": contagem }

function todayStr(): string {
  return new Date().toDateString();
}

/** Contador diário. Reinicia automaticamente para 0 quando muda o dia (00:00). */
export function getTodaySessions(): number {
  if (localStorage.getItem(DATE_KEY) !== todayStr()) {
    localStorage.setItem(DATE_KEY, todayStr());
    localStorage.setItem(TODAY_KEY, "0");
    return 0;
  }
  return parseInt(localStorage.getItem(TODAY_KEY) || "0", 10);
}

/** Total acumulado de sessões. */
export function getTotalSessions(): number {
  return parseInt(localStorage.getItem(TOTAL_KEY) || "0", 10);
}

/** Incrementa total e diário (respeitando o reset diário). */
export function incrementSessions(): { total: number; today: number } {
  const total = getTotalSessions() + 1;
  const today = getTodaySessions() + 1; // getTodaySessions já trata o reset da meia-noite
  localStorage.setItem(TOTAL_KEY, String(total));
  localStorage.setItem(TODAY_KEY, String(today));
  localStorage.setItem(DATE_KEY, todayStr());

  // Registo por dia (para o gráfico "Sessões por Dia" das Estatísticas)
  try {
    const byDay = JSON.parse(localStorage.getItem(BY_DAY_KEY) || "{}");
    const iso = new Date().toISOString().slice(0, 10);
    byDay[iso] = (byDay[iso] || 0) + 1;
    localStorage.setItem(BY_DAY_KEY, JSON.stringify(byDay));
  } catch (e) {}

  return { total, today };
}

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Sessões reais dos últimos 7 dias (hoje incluído), por dia da semana. */
export function getSessionsLast7Days(): { name: string; sessoes: number }[] {
  let byDay: Record<string, number> = {};
  try {
    byDay = JSON.parse(localStorage.getItem(BY_DAY_KEY) || "{}");
  } catch (e) {}
  const out: { name: string; sessoes: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push({ name: WEEKDAY_LABELS[d.getDay()], sessoes: byDay[iso] || 0 });
  }
  return out;
}
