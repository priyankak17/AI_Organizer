"use client";

/* =============================================================================
   NEURON ARBOR — the study tree's own page
   Put this file at:  app/tree/page.jsx   (create the `tree` folder inside app)
   It becomes  yoursite.com/tree  automatically. Nothing else is required for
   the route to exist — that's how Next.js App Router works: folders are URLs.

   This page is self-contained: it logs in, loads your state, autosaves, and
   talks to your existing /api/state and /api/ai routes. Your saved tree data
   (groups → topics → links) is used as-is; nothing is migrated.
   ============================================================================= */

import { useState, useEffect, useRef } from "react";

// ----- helpers (same shapes as the main page) -------------------------------
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const uid = () => Math.random().toString(36).slice(2, 9);
const short = (s, n = 20) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const shortUrl = (u) => u.replace(/^https?:\/\//, "").replace(/^www\./, "");

async function askAI(prompt, { system, search } = {}) {
  try {
    const r = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, system, search }),
    });
    const d = await r.json();
    return d.text || "No response. Try again.";
  } catch {
    return "Could not reach the server.";
  }
}

function extractJson(text) {
  if (!text) return null;
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function defaultTree() {
  return {
    groups: [
      {
        id: "basics",
        label: "Basics · roots",
        topics: [
          { id: "linalg", label: "Linear Algebra", links: [] },
          { id: "stats", label: "Statistics", links: [] },
          { id: "tensors", label: "Tensor Multiplication", links: [] },
          { id: "imgclass", label: "Image Classification", links: [] },
        ],
      },
      {
        id: "advanced",
        label: "Advanced · branches",
        topics: [
          { id: "seq", label: "Sequential Modelling", links: [] },
          { id: "temporal", label: "Temporal Modelling", links: [] },
          { id: "attention", label: "Attention", links: [] },
          { id: "zeroshot", label: "Zero-Shot", links: [] },
          { id: "crossmodal", label: "Cross-Modal Optimization", links: [] },
          { id: "cv", label: "CV Algorithms", links: [] },
        ],
      },
    ],
    inbox: [],
  };
}

// ----- page shell: load, login, then the arbor ------------------------------

export default function TreePage() {
  const [status, setStatus] = useState("loading"); // loading | login | ready | error
  const [state, setState] = useState(null);
  const [errMsg, setErrMsg] = useState("");

  const fetchState = async () => {
    setStatus("loading");
    setErrMsg("");
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch("/api/state", { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.status === 401) {
        setStatus("login");
        return;
      }
      if (!r.ok) {
        setErrMsg(`The data endpoint returned ${r.status}.`);
        setStatus("error");
        return;
      }
      const d = await r.json();
      setState(d.state);
      setStatus("ready");
    } catch (e) {
      setErrMsg(e && e.name === "AbortError" ? "The data request timed out." : "Could not reach the data endpoint.");
      setStatus("error");
    }
  };

  useEffect(() => {
    fetchState();
  }, []);

  if (status === "loading") return <Shell><p className="ar-dim">growing…</p></Shell>;
  if (status === "error")
    return (
      <Shell>
        <p className="ar-dim" style={{ color: "#ff7aa8" }}>{errMsg}</p>
        <button className="ar-btn" onClick={fetchState}>retry</button>
      </Shell>
    );
  if (status === "login") return <Shell><MiniLogin onDone={fetchState} /></Shell>;
  return <Arbor state={state} setState={setState} />;
}

function Shell({ children }) {
  return (
    <div className="ar-root">
      <ArborStyles />
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
        <span className="ar-eyebrow">neuron arbor</span>
        {children}
      </div>
    </div>
  );
}

function MiniLogin({ onDone }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setErr("");
    const r = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setBusy(false);
    if (r.ok) onDone();
    else setErr("Wrong password.");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
      <p className="ar-dim">The arbor is locked. Same password as your organizer.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="ar-in" type="password" placeholder="password" value={pw}
          onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <button className="ar-btn" onClick={submit} disabled={busy}>{busy ? "…" : "enter"}</button>
      </div>
      {err && <p className="ar-dim" style={{ color: "#ff7aa8" }}>{err}</p>}
    </div>
  );
}

// ----- the arbor itself ------------------------------------------------------

function Arbor({ state, setState }) {
  // Seed the tree once if this account has never had one; also add the inbox
  // if the tree predates it. Merging instead of replacing keeps old links.
  useEffect(() => {
    setState((s) => {
      if (!s) return s;
      if (!s.tree) return { ...s, tree: defaultTree() };
      if (!s.tree.inbox) return { ...s, tree: { ...s.tree, inbox: [] } };
      return s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave whole state on change, skipping the very first render — the
  // exact same pattern as your main page, so both pages save the same way.
  const firstSave = useRef(true);
  useEffect(() => {
    if (!state) return;
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  }, [state]);

  const tree = state?.tree || { groups: [], inbox: [] };
  const inbox = tree.inbox || [];

  const [selected, setSelected] = useState(null);
  const [paste, setPaste] = useState("");
  const [seedKey, setSeedKey] = useState(0); // re-keys the rising-seed animation
  const [draft, setDraft] = useState({});
  const [newTopic, setNewTopic] = useState({});
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sortErr, setSortErr] = useState("");
  const [panel, setPanel] = useState("seedlings"); // which side panel shows on small screens

  const save = (nextTree) => setState((s) => ({ ...s, tree: nextTree }));

  const advGroup = tree.groups.find((g) => g.id === "advanced") || { topics: [] };
  const basGroup = tree.groups.find((g) => g.id === "basics") || { topics: [] };
  const adv = advGroup.topics || [];
  const bas = basGroup.topics || [];
  const allTopics = tree.groups.flatMap((g) => (g.topics || []).map((t) => ({ ...t, groupId: g.id })));
  const selTopic = selected ? allTopics.find((t) => t.id === selected) : null;

  // ----- data operations -----
  const addLink = (gid, tid, url, note) => {
    url = (url || "").trim();
    if (!url) return;
    const link = { id: uid(), url, note: (note || "").trim(), added: todayStr() };
    save({
      ...tree,
      groups: tree.groups.map((g) =>
        g.id !== gid ? g : { ...g, topics: g.topics.map((t) => (t.id !== tid ? t : { ...t, links: [link, ...t.links] })) }
      ),
    });
  };
  const removeLink = (gid, tid, lid) =>
    save({
      ...tree,
      groups: tree.groups.map((g) =>
        g.id !== gid ? g : { ...g, topics: g.topics.map((t) => (t.id !== tid ? t : { ...t, links: t.links.filter((l) => l.id !== lid) })) }
      ),
    });
  const addTopic = (gid) => {
    const label = (newTopic[gid] || "").trim();
    if (!label) return;
    save({ ...tree, groups: tree.groups.map((g) => (g.id !== gid ? g : { ...g, topics: [...g.topics, { id: uid(), label, links: [] }] })) });
    setNewTopic((x) => ({ ...x, [gid]: "" }));
  };
  const removeTopic = (gid, tid) => {
    if (selected === tid) setSelected(null);
    save({ ...tree, groups: tree.groups.map((g) => (g.id !== gid ? g : { ...g, topics: g.topics.filter((t) => t.id !== tid) })) });
  };

  // Bottom bar: every pasted link becomes an unsorted seedling. The seed-of-
  // light animation fires by re-keying an <animateMotion> element below.
  const plantSeed = () => {
    const url = paste.trim();
    if (!url) return;
    save({ ...tree, inbox: [{ id: uid(), url, added: todayStr() }, ...inbox] });
    setPaste("");
    setSeedKey((k) => k + 1);
    setPanel("seedlings");
  };
  const removeSeed = (id) => save({ ...tree, inbox: inbox.filter((s) => s.id !== id) });

  // ----- real AI sort of the seedlings inbox -----
  const runSort = async () => {
    if (!inbox.length) return;
    setBusy(true);
    setSortErr("");
    setReview(null);
    const topicList = allTopics.map((t) => `${t.id} — ${t.label}`).join("\n");
    const urls = inbox.map((s) => s.url);
    const prompt =
      `Here are my study topics as "id — label":\n${topicList}\n\n` +
      `Sort each of these links into the single best-matching topic id:\n${urls.join("\n")}\n\n` +
      `Return ONLY a JSON array, no prose and no code fences, like:\n[{"url":"https://...","topicId":"attention"}]`;
    const text = await askAI(prompt, {
      system:
        'You sort study links into topics. Reply with ONLY a raw JSON array. Each item is {"url": string, "topicId": string}. topicId must be exactly one of the given ids. If unsure, pick the closest.',
    });
    const parsed = extractJson(text);
    const validIds = new Set(allTopics.map((t) => t.id));
    let suggestions;
    if (Array.isArray(parsed)) {
      const byUrl = {};
      for (const p of parsed) if (p && p.url) byUrl[String(p.url).trim()] = p.topicId;
      suggestions = inbox.map((s) => {
        let tid = byUrl[s.url];
        if (!validIds.has(tid)) tid = allTopics[0] ? allTopics[0].id : null;
        return { seedId: s.id, url: s.url, topicId: tid };
      });
    } else {
      setSortErr("The AI reply could not be read; everything defaulted to the first topic. Fix the dropdowns, then file.");
      suggestions = inbox.map((s) => ({ seedId: s.id, url: s.url, topicId: allTopics[0] ? allTopics[0].id : null }));
    }
    setReview(suggestions);
    setBusy(false);
  };

  const commitReview = () => {
    let next = tree;
    const filedSeedIds = [];
    for (const r of review) {
      const t = allTopics.find((x) => x.id === r.topicId);
      if (!t) continue;
      const link = { id: uid(), url: r.url, note: "sorted by ai", added: todayStr() };
      next = {
        ...next,
        groups: next.groups.map((g) =>
          g.id !== t.groupId ? g : { ...g, topics: g.topics.map((tp) => (tp.id !== t.id ? tp : { ...tp, links: [link, ...tp.links] })) }
        ),
      };
      filedSeedIds.push(r.seedId);
    }
    next = { ...next, inbox: (next.inbox || []).filter((s) => !filedSeedIds.includes(s.id)) };
    save(next);
    setReview(null);
    setSortErr("");
  };

  // ----- layout math: the tree is computed fresh from the data every render --
  const W = 1100;
  const cx = W / 2;
  const limbCount = Math.min(4, Math.max(1, adv.length));
  const perLimb = Math.ceil(adv.length / limbCount) || 1;
  const nodeGap = 46;
  const canopyTop = 56;
  const canopyBase = canopyTop + (perLimb - 1) * nodeGap + 30;
  const crotchY = canopyBase + 110;   // where limbs meet the trunk
  const baseY = crotchY + 120;        // where roots leave the trunk
  const rootsY = baseY + 130;         // the root node row
  const H = rootsY + 86;

  // advanced topics dealt round-robin into limbs so they stay balanced
  const limbs = Array.from({ length: limbCount }, () => []);
  adv.forEach((t, i) => limbs[i % limbCount].push(t));
  const limbX = (k) => cx + (k - (limbCount - 1) / 2) * (W / (limbCount + 0.6));

  // node visual state: dim outline (empty) / nourished glow / dense glow
  const nodeClass = (n) => (n >= 5 ? "dense" : n >= 1 ? "nourished" : "new");

  const trunkPath = `M ${cx} ${baseY} C ${cx - 14} ${baseY - 60}, ${cx + 14} ${crotchY + 50}, ${cx} ${crotchY}`;
  const seedPath = `M ${cx} ${H - 8} L ${cx} ${baseY} C ${cx - 14} ${baseY - 60}, ${cx + 14} ${crotchY + 50}, ${cx} ${crotchY}`;

  return (
    <div className="ar-root">
      <ArborStyles />

      <div className="ar-top">
        <a href="/" className="ar-back">← organizer</a>
        <div className="ar-titlebox">
          <h1 className="ar-title">Neuron Arbor</h1>
          <span className="ar-subtitle">— the cortex canopy —</span>
        </div>
        <div className="ar-legend">
          <span className="ar-eyebrow" style={{ letterSpacing: ".14em" }}>legend</span>
          <div className="ar-leg-row"><span className="ar-leg-dot new" /> new node</div>
          <div className="ar-leg-row"><span className="ar-leg-dot nourished" /> nourished</div>
          <div className="ar-leg-row"><span className="ar-leg-dot dense" /> dense</div>
        </div>
      </div>

      <div className="ar-stage">
        {/* left: unsorted seedlings */}
        <div className={`ar-panel ar-left ${panel === "seedlings" ? "" : "ar-hide-mobile"}`}>
          <div className="ar-panel-head">🌱 unsorted seedlings <span className="ar-count">{inbox.length}</span></div>
          {inbox.length === 0 && !review && <p className="ar-dim">Paste links in the bar below. They land here first.</p>}
          {!review && inbox.map((s) => (
            <div className="ar-seed" key={s.id}>
              <span className="ar-mono">{short(shortUrl(s.url), 34)}</span>
              <span className="ar-x" onClick={() => removeSeed(s.id)}>×</span>
            </div>
          ))}
          {!review && inbox.length > 0 && (
            <button className="ar-btn gold" style={{ marginTop: 10, width: "100%" }} onClick={runSort} disabled={busy}>
              {busy ? "sorting…" : "sort seedlings with ai"}
            </button>
          )}
          {sortErr && <p className="ar-dim" style={{ color: "#ff7aa8", marginTop: 8 }}>{sortErr}</p>}
          {review && (
            <>
              <p className="ar-dim" style={{ marginBottom: 8 }}>Review the guesses, fix any dropdown, then file.</p>
              {review.map((r, i) => (
                <div className="ar-seed" key={r.seedId} style={{ flexWrap: "wrap" }}>
                  <span className="ar-mono" style={{ width: "100%" }}>{short(shortUrl(r.url), 34)}</span>
                  <select className="ar-in" style={{ width: "100%", marginTop: 4 }} value={r.topicId || ""}
                    onChange={(e) => setReview((rv) => rv.map((x, j) => (j === i ? { ...x, topicId: e.target.value } : x)))}>
                    {allTopics.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="ar-btn gold" onClick={commitReview}>file all</button>
                <button className="ar-btn ghost" onClick={() => setReview(null)}>cancel</button>
              </div>
            </>
          )}
          <div className="ar-grow-controls">
            <div style={{ display: "flex", gap: 6 }}>
              <input className="ar-in" placeholder="new branch" value={newTopic.advanced || ""}
                onChange={(e) => setNewTopic((x) => ({ ...x, advanced: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && addTopic("advanced")} />
              <button className="ar-btn ghost" onClick={() => addTopic("advanced")}>+</button>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input className="ar-in" placeholder="new root" value={newTopic.basics || ""}
                onChange={(e) => setNewTopic((x) => ({ ...x, basics: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && addTopic("basics")} />
              <button className="ar-btn ghost" onClick={() => addTopic("basics")}>+</button>
            </div>
          </div>
        </div>

        {/* center: the tree, drawn from data */}
        <div className="ar-treewrap">
          <svg viewBox={`0 0 ${W} ${H}`} className="ar-svg" preserveAspectRatio="xMidYMid meet">
            <defs>
              <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="3.2" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <filter id="glowBig" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="6" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <linearGradient id="trunkGrad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#3fae8c" /><stop offset="100%" stopColor="#37e0b8" />
              </linearGradient>
            </defs>

            {/* trunk */}
            <path d={trunkPath} className="ar-pulse" stroke="url(#trunkGrad)" strokeWidth="9" fill="none"
              strokeLinecap="round" filter="url(#glowBig)" />

            {/* limbs + advanced nodes */}
            {limbs.map((list, k) => {
              const lx = limbX(k);
              const labelLeft = lx < cx; // outer-left limbs put labels on the left
              return (
                <g key={"limb" + k}>
                  <path d={`M ${cx} ${crotchY} Q ${(cx + lx) / 2} ${canopyBase + 60}, ${lx} ${canopyBase + 12}`}
                    stroke="#37e0b8" strokeWidth="2.5" fill="none" opacity="0.6" filter="url(#glow)" />
                  {list.length > 1 && (
                    <line x1={lx} y1={canopyBase} x2={lx} y2={canopyBase - (list.length - 1) * nodeGap}
                      stroke="#2a6a56" strokeWidth="1.4" opacity="0.8" />
                  )}
                  {list.map((t, j) => {
                    const y = canopyBase - j * nodeGap;
                    const cls = nodeClass(t.links.length);
                    const isSel = selected === t.id;
                    return (
                      <g key={t.id} className="ar-node" onClick={() => { setSelected(t.id); setPanel("slate"); }}>
                        <circle cx={lx} cy={y} r={isSel ? 9 : 7}
                          className={`ar-nodecircle ${cls} ${isSel ? "sel" : ""}`}
                          filter={cls === "new" ? undefined : "url(#glow)"} />
                        <text x={labelLeft ? lx - 16 : lx + 16} y={y + 4}
                          textAnchor={labelLeft ? "end" : "start"}
                          className={`ar-label ${isSel ? "sel" : ""}`}>
                          {short(t.label)} <tspan className="ar-cnt">{t.links.length ? `· ${t.links.length}` : ""}</tspan>
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* roots + basics nodes */}
            {bas.map((t, i) => {
              const rx = (W * (i + 1)) / (bas.length + 1);
              const cls = nodeClass(t.links.length);
              const isSel = selected === t.id;
              return (
                <g key={t.id} className="ar-node" onClick={() => { setSelected(t.id); setPanel("slate"); }}>
                  <path d={`M ${cx} ${baseY} C ${cx} ${baseY + 70}, ${rx} ${rootsY - 90}, ${rx} ${rootsY - 22}`}
                    stroke="#3fae8c" strokeWidth="2" fill="none" opacity="0.55" filter="url(#glow)" />
                  <circle cx={rx} cy={rootsY} r={isSel ? 17 : 15}
                    className={`ar-nodecircle root ${cls} ${isSel ? "sel" : ""}`}
                    filter={cls === "new" ? undefined : "url(#glow)"} />
                  <text x={rx} y={rootsY + 4} textAnchor="middle" className="ar-rootcnt">{t.links.length}</text>
                  <text x={rx} y={rootsY + 34} textAnchor="middle" className={`ar-label ${isSel ? "sel" : ""}`}>{short(t.label, 22)}</text>
                </g>
              );
            })}

            {/* the seed of light rising when you plant a link */}
            {seedKey > 0 && (
              <circle key={seedKey} r="5" fill="#e8c97a" filter="url(#glowBig)">
                <animateMotion dur="1.4s" fill="freeze" path={seedPath} />
                <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.85;1" dur="1.4s" fill="freeze" />
              </circle>
            )}
          </svg>
        </div>

        {/* right: memory slate */}
        <div className={`ar-panel ar-right ${panel === "slate" ? "" : "ar-hide-mobile"}`}>
          <div className="ar-panel-head">⬡ memory slate</div>
          {!selTopic && <p className="ar-dim">Tap a node on the tree to open its slate.</p>}
          {selTopic && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span className="ar-slate-title">{selTopic.label}</span>
                <span className="ar-x" style={{ fontSize: 11, fontFamily: "var(--armono)" }}
                  onClick={() => removeTopic(selTopic.groupId, selTopic.id)}>delete topic</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <input className="ar-in" placeholder="paste a link" value={draft.url || ""}
                  onChange={(e) => setDraft((x) => ({ ...x, url: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") { addLink(selTopic.groupId, selTopic.id, draft.url, draft.note); setDraft({}); } }} />
                <button className="ar-btn gold" onClick={() => { addLink(selTopic.groupId, selTopic.id, draft.url, draft.note); setDraft({}); }}>add</button>
              </div>
              {selTopic.links.length === 0 && <p className="ar-dim">No links yet. This node is waiting to be nourished.</p>}
              {selTopic.links.map((l, i) => (
                <div className="ar-slate-row" key={l.id}>
                  <span className="ar-slate-num">{String(i + 1).padStart(2, "0")}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="ar-mono ar-link">{short(shortUrl(l.url), 40)}</a>
                    {l.note ? <div className="ar-dim" style={{ fontSize: 11 }}>{l.note}</div> : null}
                  </span>
                  <span className="ar-x" onClick={() => removeLink(selTopic.groupId, selTopic.id, l.id)}>×</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* bottom: the permanent paste bar */}
      <div className="ar-bottombar">
        <input className="ar-pastebar" placeholder="Paste link here…" value={paste}
          onChange={(e) => setPaste(e.target.value)} onKeyDown={(e) => e.key === "Enter" && plantSeed()} />
        <button className="ar-btn gold" onClick={plantSeed}>↵</button>
      </div>

      {/* mobile panel switcher */}
      <div className="ar-mobile-switch">
        <button className={`ar-btn ghost ${panel === "seedlings" ? "on" : ""}`} onClick={() => setPanel("seedlings")}>seedlings</button>
        <button className={`ar-btn ghost ${panel === "slate" ? "on" : ""}`} onClick={() => setPanel("slate")}>slate</button>
      </div>
    </div>
  );
}

// ----- styles ----------------------------------------------------------------

function ArborStyles() {
  return (
    <style>{`
      :root{--arbg:#070d0a;--arpanel:rgba(13,26,20,.82);--arline:#1c332a;--arteal:#37e0b8;--argreen:#6ff0c0;--argold:#e8c97a;--artext:#d9efe4;--ardim:#6f8f83;--armono:ui-monospace,SFMono-Regular,Menlo,monospace;--arsans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;}
      .ar-root{min-height:100vh;background:radial-gradient(1200px 700px at 50% 42%, #0c1712 0%, var(--arbg) 62%);color:var(--artext);font-family:var(--arsans);padding-bottom:90px;}
      .ar-top{display:flex;align-items:flex-start;justify-content:space-between;padding:18px 22px 0;gap:14px;flex-wrap:wrap;}
      .ar-back{color:var(--ardim);font-family:var(--armono);font-size:12px;text-decoration:none;border:1px solid var(--arline);padding:7px 11px;border-radius:8px;}
      .ar-back:hover{color:var(--arteal);border-color:var(--arteal);}
      .ar-titlebox{text-align:center;flex:1;}
      .ar-title{font-size:30px;font-weight:600;letter-spacing:.06em;margin:0;color:#f2efe2;text-shadow:0 0 22px rgba(232,201,122,.35);}
      .ar-subtitle{font-family:var(--armono);font-size:11px;letter-spacing:.3em;color:var(--ardim);text-transform:uppercase;}
      .ar-eyebrow{font-family:var(--armono);font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--ardim);}
      .ar-legend{border:1px solid var(--arline);border-radius:10px;padding:10px 14px;background:var(--arpanel);font-size:12px;}
      .ar-leg-row{display:flex;align-items:center;gap:8px;margin-top:6px;color:var(--ardim);}
      .ar-leg-dot{width:10px;height:10px;border-radius:50%;display:inline-block;}
      .ar-leg-dot.new{border:1.5px solid #2a6a56;}
      .ar-leg-dot.nourished{background:var(--arteal);box-shadow:0 0 8px var(--arteal);}
      .ar-leg-dot.dense{background:var(--argreen);box-shadow:0 0 14px var(--argreen),0 0 26px rgba(111,240,192,.5);}
      .ar-stage{display:grid;grid-template-columns:250px 1fr 290px;gap:14px;padding:12px 22px;align-items:start;}
      .ar-treewrap{overflow-x:auto;}
      .ar-svg{width:100%;min-width:640px;display:block;}
      .ar-panel{background:var(--arpanel);border:1px solid var(--arline);border-radius:14px;padding:14px;backdrop-filter:blur(4px);}
      .ar-panel-head{font-family:var(--armono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--arteal);margin-bottom:10px;display:flex;align-items:center;gap:8px;}
      .ar-count{background:rgba(55,224,184,.14);border-radius:6px;padding:1px 7px;font-size:11px;}
      .ar-dim{color:var(--ardim);font-size:13px;line-height:1.5;}
      .ar-seed{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--arline);font-size:12px;}
      .ar-mono{font-family:var(--armono);font-size:12px;color:var(--artext);word-break:break-all;}
      .ar-link{color:var(--arteal);text-decoration:none;} .ar-link:hover{text-shadow:0 0 8px var(--arteal);}
      .ar-x{color:var(--ardim);cursor:pointer;padding:0 4px;font-size:16px;line-height:1;} .ar-x:hover{color:#ff7aa8;}
      .ar-in{background:rgba(7,13,10,.9);border:1px solid var(--arline);color:var(--artext);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;flex:1;min-width:0;font-family:var(--arsans);}
      .ar-in:focus{border-color:var(--arteal);box-shadow:0 0 10px rgba(55,224,184,.25);}
      .ar-btn{background:var(--arteal);color:#04140e;border:none;border-radius:8px;padding:8px 13px;font-weight:700;font-size:12px;cursor:pointer;font-family:var(--armono);letter-spacing:.04em;}
      .ar-btn.gold{background:var(--argold);color:#241a04;box-shadow:0 0 14px rgba(232,201,122,.3);}
      .ar-btn.ghost{background:transparent;color:var(--ardim);border:1px solid var(--arline);}
      .ar-btn.ghost.on{color:var(--arteal);border-color:var(--arteal);}
      .ar-btn:disabled{opacity:.45;cursor:default;}
      .ar-grow-controls{margin-top:16px;border-top:1px dashed var(--arline);padding-top:12px;}
      .ar-nodecircle{cursor:pointer;transition:r .15s;}
      .ar-nodecircle.new{fill:#0d1a14;stroke:#2a6a56;stroke-width:1.5;}
      .ar-nodecircle.nourished{fill:var(--arteal);stroke:none;}
      .ar-nodecircle.dense{fill:var(--argreen);stroke:rgba(111,240,192,.5);stroke-width:4;}
      .ar-nodecircle.sel{stroke:var(--argold);stroke-width:2.5;}
      .ar-nodecircle.root.new{fill:#0d1a14;}
      .ar-label{font-family:var(--armono);font-size:13px;fill:var(--artext);cursor:pointer;}
      .ar-label.sel{fill:var(--argold);}
      .ar-cnt{fill:var(--ardim);font-size:11px;}
      .ar-rootcnt{font-family:var(--armono);font-size:11px;fill:#04140e;font-weight:700;pointer-events:none;}
      .ar-node:hover .ar-label{fill:var(--argold);}
      .ar-pulse{animation:arPulse 4.5s ease-in-out infinite;}
      @keyframes arPulse{0%,100%{opacity:.55}50%{opacity:1}}
      .ar-slate-title{font-size:16px;font-weight:600;color:#f2efe2;}
      .ar-slate-row{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--arline);}
      .ar-slate-num{font-family:var(--armono);font-size:11px;color:var(--argold);padding-top:2px;}
      .ar-bottombar{position:fixed;left:0;right:0;bottom:0;display:flex;gap:8px;justify-content:center;padding:14px 18px;background:linear-gradient(transparent, rgba(7,13,10,.95) 40%);}
      .ar-pastebar{width:min(560px, 78vw);background:rgba(13,26,20,.9);border:1px solid var(--arline);border-radius:12px;color:var(--artext);padding:12px 16px;font-family:var(--armono);font-size:13px;outline:none;box-shadow:0 0 18px rgba(55,224,184,.12);}
      .ar-pastebar:focus{border-color:var(--argold);box-shadow:0 0 20px rgba(232,201,122,.28);}
      .ar-mobile-switch{display:none;}
      @media (max-width: 900px){
        .ar-stage{grid-template-columns:1fr;}
        .ar-hide-mobile{display:none;}
        .ar-mobile-switch{display:flex;gap:8px;justify-content:center;padding:0 22px;}
        .ar-legend{display:none;}
        .ar-title{font-size:22px;}
      }
    `}</style>
  );
}