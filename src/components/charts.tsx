import Link from "next/link";

/* Server-rendered charts (no JS: works under the strict CSP). Palette validated with the
   dataviz checker: open / known / proved are blue / amber / green with direct labels + legend
   (amber is below 3:1 against white, so every value is also written out and in the data table). */
export const SERIES = { open: "#2a62b8", known: "#e0a030", proved: "#2e8b45", single: "#256abf" };

const fmt = (n: number) => n.toLocaleString("en");
const niceMax = (v: number) => {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v)), m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
};
/** Column with a 4px rounded data-end, square at the baseline. */
const colPath = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="chart-data">
      <summary>Data</summary>
      <table className="t"><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === "number" ? "num" : ""}>{typeof c === "number" ? fmt(c) : c}</td>)}</tr>)}</tbody></table>
    </details>
  );
}

/** Where the problems stand: one segmented bar, direct labels in the legend under it. */
export function StandingBar({ open, known, proved }: { open: number; known: number; proved: number }) {
  const total = open + known + proved || 1;
  const segs = [
    { k: "open", label: "Nobody knows the answer yet", sub: "open problems", v: open, c: SERIES.open, href: "/list/math?status=open" },
    { k: "known", label: "Answer known on paper, not yet checked by Lean", sub: "known results", v: known, c: SERIES.known, href: "/list/math?status=solved" },
    { k: "proved", label: "Proved here and checked by Lean", sub: "proved here", v: proved, c: SERIES.proved, href: "/list/math?status=proved" },
  ];
  const W = 1000, gap = 2;
  let x = 0;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} 28`} className="chart-svg" role="img" aria-label={`${fmt(open)} open, ${fmt(known)} known on paper, ${fmt(proved)} proved here`} preserveAspectRatio="none" style={{ height: 28 }}>
        {segs.map((s) => {
          const w = s.v ? Math.max(4, (s.v / total) * W - gap) : 0;
          const r = <rect key={s.k} x={x} y={0} width={w} height={28} fill={s.c} className="ch-mark"><title>{`${s.sub}: ${fmt(s.v)} (${((s.v / total) * 100).toFixed(1)} %)`}</title></rect>;
          x += w + (w ? gap : 0);
          return r;
        })}
      </svg>
      <ul className="chart-legend">
        {segs.map((s) => (
          <li key={s.k}><span className="sw" style={{ background: s.c }} aria-hidden />
            <Link href={s.href}><b>{fmt(s.v)}</b> {s.label}</Link> <span className="muted">· {((s.v / total) * 100).toFixed(s.v / total < 0.01 && s.v ? 1 : 0)} %</span></li>
        ))}
      </ul>
    </figure>
  );
}

/** Daily columns, one series, value written on the busiest day and the total in the caption. */
export function DailyColumns({ data, label }: { data: { day: string; checks: number; verified: number }[]; label: string }) {
  const W = 600, H = 150, L = 30, B = 20, T = 14;
  const max = niceMax(Math.max(1, ...data.map((d) => d.checks)));
  const slot = (W - L) / Math.max(1, data.length), bw = Math.min(24, slot - 2);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const peak = data.reduce((a, d, i) => (d.checks > data[a].checks ? i : a), 0);
  const short = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={label}>
        {[0, max / 2, max].map((t) => (
          <g key={t}><line x1={L} x2={W} y1={y(t)} y2={y(t)} className="ch-grid" /><text x={L - 6} y={y(t) + 4} className="ch-tick" textAnchor="end">{fmt(t)}</text></g>
        ))}
        {data.map((d, i) => {
          const x = L + i * slot + (slot - bw) / 2, h = (H - T - B) * (d.checks / max);
          return (
            <g key={d.day} className="ch-col">
              <rect x={L + i * slot} y={T} width={slot} height={H - T - B} fill="transparent"><title>{`${short(d.day)}: ${d.checks} checked, ${d.verified} accepted`}</title></rect>
              {d.checks > 0 && <path d={colPath(x, y(d.checks), bw, h)} fill={SERIES.single} className="ch-mark" pointerEvents="none" />}
            </g>
          );
        })}
        {data[peak]?.checks > 0 && <text x={L + peak * slot + slot / 2} y={y(data[peak].checks) - 4} className="ch-val" textAnchor="middle">{data[peak].checks}</text>}
        {[0, Math.floor(data.length / 2), data.length - 1].map((i) => data[i] && (
          <text key={i} x={L + i * slot + slot / 2} y={H - 5} className="ch-tick" textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}>{short(data[i].day)}</text>
        ))}
      </svg>
      <DataTable head={["Day", "Checked", "Accepted"]} rows={data.filter((d) => d.checks).map((d) => [d.day, d.checks, d.verified])} />
    </figure>
  );
}

/** Horizontal bars in HTML (crisp at any width); value at the tip. */
export function HBars({ rows }: { rows: { label: string; value: number; sub?: string; href?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className="chart hbars">
      {rows.map((r) => (
        <div key={r.label} className="hb-row" title={`${r.label}: ${fmt(r.value)}${r.sub ? ` (${r.sub})` : ""}`}>
          <div className="hb-label">{r.href ? <Link href={r.href}>{r.label}</Link> : r.label}</div>
          <div className="hb-track"><span className="hb-bar ch-mark" style={{ width: `${(r.value / max) * 72}%`, background: SERIES.single }} /><span className="hb-val">{fmt(r.value)}{r.sub && <span className="muted"> · {r.sub}</span>}</span></div>
        </div>
      ))}
    </figure>
  );
}

/** Record progression: a step line from the starting value to the current record. */
export function RecordSteps({ points, baseline, direction, metric }: { points: { value: number; created_at: string; handle: string }[]; baseline: number | null; direction: string; metric: string }) {
  const W = 600, H = 170, L = 40, R = 70, T = 16, B = 22;
  const series = [...(baseline != null ? [{ value: baseline, created_at: "", handle: "starting value" }] : []), ...points];
  if (series.length < 2) return null;
  const vals = series.map((p) => p.value);
  const max = niceMax(Math.max(...vals)), min = 0;
  const x = (i: number) => L + (i / (series.length - 1)) * (W - L - R);
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
  let d = `M${x(0)},${y(series[0].value)}`;
  for (let i = 1; i < series.length; i++) d += `H${x(i)}V${y(series[i].value)}`;
  const last = series[series.length - 1];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label={`${metric}: from ${fmt(series[0].value)} to ${fmt(last.value)} over ${points.length} records`}>
        {[min, max / 2, max].map((t) => (
          <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="ch-grid" /><text x={L - 6} y={y(t) + 4} className="ch-tick" textAnchor="end">{fmt(t)}</text></g>
        ))}
        <path d={d} fill="none" stroke={SERIES.single} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {series.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={5} fill={i === 0 && baseline != null ? "#fff" : SERIES.single} stroke={i === 0 && baseline != null ? SERIES.single : "#fff"} strokeWidth={2} className="ch-dot">
            <title>{`${fmt(p.value)} — ${p.handle}${p.created_at ? `, ${new Date(p.created_at).toISOString().slice(0, 10)}` : ""}`}</title>
          </circle>
        ))}
        <text x={x(series.length - 1) + 9} y={y(last.value) + 4} className="ch-val">{fmt(last.value)}</text>
        {baseline != null && <text x={x(0) + 8} y={y(series[0].value) - 8} className="ch-tick">start {fmt(series[0].value)}</text>}
        <text x={L} y={H - 5} className="ch-tick">{direction === "min" ? "lower is better" : "higher is better"} · each step is a verified improvement</text>
      </svg>
      <DataTable head={["Value", "By", "Date"]} rows={points.map((p) => [p.value, p.handle, new Date(p.created_at).toISOString().slice(0, 10)])} />
    </figure>
  );
}

/** "How it works" flow, drawn as four boxes and arrows. */
export function HowItWorks() {
  const steps = [
    ["1", "Pick a problem", "A real open question, written so precisely a computer can read it."],
    ["2", "Your AI works on it", "With you, or alone. It sees what others tried and which ideas failed."],
    ["3", "A computer checks it", "Lean replays every step of the proof. One gap and it is rejected."],
    ["4", "It counts, forever", "Points, a place on the leaderboard and a public, permanent record."],
  ];
  return (
    <ol className="how">
      {steps.map(([n, t, d]) => (
        <li key={n}><span className="how-n" aria-hidden>{n}</span><b>{t}</b><span>{d}</span></li>
      ))}
    </ol>
  );
}
