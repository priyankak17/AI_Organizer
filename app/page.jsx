"use client";

import { useState, useEffect, useRef } from "react";

// ----- small helpers -------------------------------------------------------

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const yesterdayStr = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const uid = () => Math.random().toString(36).slice(2, 9);

// Turn a Google event into the same shape the app uses for manual events.
// Crucially, the timezone conversion happens HERE, in the browser, because
// only the browser knows your real local timezone. `new Date(isoString)`
// reads Google's timestamp (which includes its zone) and converts it to your
// local clock, so an event saved as 2pm in another zone shows at your 2pm.
function normalizeGoogle(ev) {
  if (ev.allDay) {
    // all-day events have a plain date and no clock time
    return { id: `g_${ev.id}`, source: "google", date: ev.startDate, time: "", title: ev.title, allDay: true };
  }
  const d = new Date(ev.startDateTime);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { id: `g_${ev.id}`, source: "google", date, time, title: ev.title, allDay: false };
}

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
    return "Could not reach the server. Check your connection and try again.";
  }
}

function linkify(text) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

// ----- top level: handles loading, login, then the app --------------------

export default function Page() {
  const [status, setStatus] = useState("loading"); // loading | login | ready | error
  const [locked, setLocked] = useState(false);
  const [state, setState] = useState(null);
  const [errMsg, setErrMsg] = useState("");

  const fetchState = async () => {
    setStatus("loading");
    setErrMsg("");
    try {
      // never hang forever: give up after 15 seconds
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch("/api/state", { signal: ctrl.signal });
      clearTimeout(timer);

      if (r.status === 401) {
        const d = await r.json().catch(() => ({}));
        setLocked(Boolean(d.locked));
        setStatus("login");
        return;
      }
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        setErrMsg(`The data endpoint returned ${r.status}. ${body.slice(0, 220)}`);
        setStatus("error");
        return;
      }
      const d = await r.json();
      setState(d.state);
      setStatus("ready");
    } catch (e) {
      setErrMsg(
        e && e.name === "AbortError"
          ? "The data request timed out after 15 seconds. The server may be erroring."
          : "Could not reach the data endpoint. " + (e && e.message ? e.message : "")
      );
      setStatus("error");
    }
  };

  useEffect(() => {
    fetchState();
  }, []);

  if (status === "loading") {
    return (
      <div className="pk-root">
        <div className="pk-wrap">
          <span className="pk-eyebrow"><span className="pk-dot" />booting...</span>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="pk-root">
        <div className="pk-login">
          <span className="pk-eyebrow"><span className="pk-dot" />pynk // ops</span>
          <div className="pk-card" style={{ marginTop: 14 }}>
            <h3 className="pk-h">Could not load</h3>
            <p className="pk-sub">Something went wrong talking to the server. Here is what it said:</p>
            <div className="pk-ai" style={{ color: "var(--pink)" }}>{errMsg}</div>
            <button className="pk-btn" style={{ marginTop: 12 }} onClick={fetchState}>retry</button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "login") {
    return <Login onDone={fetchState} />;
  }

  return <Organizer state={state} setState={setState} />;
}

// ----- login ---------------------------------------------------------------

function Login({ onDone }) {
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
    else setErr("Wrong password. Try again.");
  };

  return (
    <div className="pk-root">
      <div className="pk-login">
        <span className="pk-eyebrow"><span className="pk-dot" />pynk // ops</span>
        <div className="pk-card" style={{ marginTop: 14 }}>
          <h3 className="pk-h">Locked</h3>
          <p className="pk-sub">Enter your password to open your organizer.</p>
          <div className="pk-row">
            <input
              className="pk-in"
              type="password"
              placeholder="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <button className="pk-btn" onClick={submit} disabled={busy}>
              {busy ? <span className="pk-spin" /> : "enter"}
            </button>
          </div>
          {err && <p className="pk-sub" style={{ color: "var(--pink)", marginTop: 10, marginBottom: 0 }}>{err}</p>}
        </div>
      </div>
    </div>
  );
}

// ----- organizer (the four tabs) -------------------------------------------

function Organizer({ state, setState }) {
  const [tab, setTab] = useState("calendar");
  const [now, setNow] = useState(new Date());
  const firstSave = useRef(true);

  // Google Calendar: events live here (separate from saved state), plus a small
  // status object so the UI always knows whether to show connect / reconnect /
  // disconnect, or a configuration hint.
  const [googleEvents, setGoogleEvents] = useState([]);
  const [gConn, setGConn] = useState({
    loading: true,
    connected: false,
    configured: true,
    needsReconnect: false,
    error: "",
  });
  const [gNotice, setGNotice] = useState("");

  // daily rollover for habits on first mount
  useEffect(() => {
    if (state && state.habits.date !== todayStr()) {
      setState((s) => ({ ...s, habits: { date: todayStr(), swim: false, gym: false, meditation: false } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // save to server whenever state changes (skip the first render)
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

  // tick the clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // pull Google events (called on load, and again after connect / disconnect)
  const loadGoogle = async () => {
    setGConn((g) => ({ ...g, loading: true }));
    try {
      const r = await fetch("/api/google/events");
      if (r.status === 401) {
        setGConn({ loading: false, connected: false, configured: true, needsReconnect: false, error: "" });
        return;
      }
      const d = await r.json();
      setGoogleEvents(Array.isArray(d.events) ? d.events.map(normalizeGoogle) : []);
      setGConn({
        loading: false,
        connected: Boolean(d.connected),
        configured: d.configured !== false,
        needsReconnect: Boolean(d.needsReconnect),
        error: d.error || "",
      });
    } catch {
      setGoogleEvents([]);
      setGConn({ loading: false, connected: false, configured: true, needsReconnect: false, error: "Could not reach the Google events endpoint." });
    }
  };

  useEffect(() => {
    loadGoogle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // after the Google round-trip we land back with ?connected=1 or ?gerror=...
  // show a one-line note, then tidy the address bar
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("connected")) setGNotice("Google Calendar connected.");
    else if (sp.get("gerror")) setGNotice("Google connection issue: " + sp.get("gerror"));
    if (sp.get("connected") || sp.get("gerror")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  if (!state) return null;

  // both your hand-typed events and today's Google events, merged and sorted.
  // because this single list feeds the "next move" logic below, your next move
  // now reacts to real calendar events too, with no extra wiring.
  const manualToday = state.events.filter((e) => e.date === todayStr());
  const googleToday = googleEvents.filter((e) => e.date === todayStr());
  const todaysEvents = [...manualToday, ...googleToday].sort((a, b) =>
    (a.time || "00:00").localeCompare(b.time || "00:00")
  );

  const nextDirective = () => {
    const hour = now.getHours();
    const mins = hour * 60 + now.getMinutes();
    const soon = todaysEvents.find((e) => {
      const [h, m] = e.time.split(":").map(Number);
      const evMin = h * 60 + m;
      return evMin >= mins && evMin - mins <= 90;
    });
    if (soon) return `Coming up at ${soon.time}: ${soon.title}. Get ready.`;
    if (hour < 11 && !state.habits.gym && !state.habits.swim)
      return "Morning move: swim or gym before the day eats it.";
    const openTask = state.tasks.find((t) => !t.done);
    if (openTask) return `Smallest win: ${openTask.text}. Just start that one.`;
    if (!state.habits.meditation) return "Quiet moment: try a two minute reset. Hit the meditation nudge.";
    return "You are clear. Breathe, then pick what matters.";
  };

  return (
    <div className="pk-root">
      <div className="pk-wrap">
        <div className="pk-row" style={{ justifyContent: "space-between" }}>
          <span className="pk-eyebrow"><span className="pk-dot" />pynk // ops</span>
          <span className="pk-clock">
            {now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
            {"  "}
            {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>

        <div className="pk-next">
          <div className="label">next move</div>
          <div className="line">{nextDirective()}<span className="pk-cursor" /></div>
        </div>

        {gNotice && (
          <p className="pk-sub" style={{ marginTop: 8, marginBottom: 0, color: "var(--cyan, var(--ok))" }}>
            {gNotice}
          </p>
        )}

        <div className="pk-tabs">
          {[["calendar", "calendar"], ["habits", "habits"], ["tasks", "tasks"], ["insta", "insta"], ["tree", "study tree"]].map(([id, label]) => (
            <button key={id} className={`pk-tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === "calendar" && <Calendar state={state} setState={setState} todaysEvents={todaysEvents} gConn={gConn} reloadGoogle={loadGoogle} />}
        {tab === "habits" && <Habits state={state} setState={setState} />}
        {tab === "tasks" && <Tasks state={state} setState={setState} />}
        {tab === "insta" && <Insta state={state} setState={setState} />}
        {tab === "tree" && <StudyTree state={state} setState={setState} />}
      </div>
    </div>
  );
}

// ----- Calendar ------------------------------------------------------------

function Calendar({ state, setState, todaysEvents, gConn, reloadGoogle }) {
  const [time, setTime] = useState("");
  const [title, setTitle] = useState("");

  // full-page navigation so the Google redirect chain works cleanly
  const connectGoogle = () => { window.location.href = "/api/google/connect"; };
  const disconnectGoogle = async () => {
    await fetch("/api/google/disconnect", { method: "POST" }).catch(() => {});
    reloadGoogle();
  };

  const add = () => {
    if (!title.trim()) return;
    const ev = { id: uid(), date: todayStr(), time: time || "09:00", title: title.trim() };
    setState((s) => ({ ...s, events: [...s.events, ev] }));
    setTitle("");
    setTime("");
  };
  const remove = (id) => setState((s) => ({ ...s, events: s.events.filter((e) => e.id !== id) }));

  return (
    <div className="pk-card">
      <h3 className="pk-h">Today</h3>
      <p className="pk-sub">Your typed events and your Google Calendar events show here together.</p>

      <div className="pk-row" style={{ marginBottom: 14, gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {gConn.loading ? (
          <span className="pk-sub" style={{ margin: 0 }}>checking Google…</span>
        ) : gConn.configured === false ? (
          <span className="pk-sub" style={{ margin: 0 }}>Google not set up yet. Add the keys, then redeploy.</span>
        ) : gConn.connected ? (
          <>
            <span className="pk-sub" style={{ margin: 0, color: "var(--ok)" }}>● Google Calendar connected</span>
            <button className="pk-btn" onClick={disconnectGoogle}>disconnect</button>
          </>
        ) : (
          <>
            <span className="pk-sub" style={{ margin: 0 }}>
              {gConn.needsReconnect ? "Google session expired, please reconnect." : "Connect to pull in your real events."}
            </span>
            <button className="pk-btn" onClick={connectGoogle}>
              {gConn.needsReconnect ? "reconnect" : "connect Google"}
            </button>
          </>
        )}
      </div>
      {gConn.error && gConn.connected && (
        <p className="pk-sub" style={{ marginTop: 0, color: "var(--pink)" }}>Google said: {gConn.error}</p>
      )}
      <div className="pk-row" style={{ marginBottom: 14 }}>
        <input className="pk-in pk-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        <input
          className="pk-in"
          placeholder="event title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="pk-btn" onClick={add}>add</button>
      </div>
      {todaysEvents.length === 0 && <p className="pk-sub" style={{ margin: 0 }}>Nothing logged yet. Add your first event.</p>}
      {todaysEvents.map((e) => (
        <div className="pk-item" key={e.id}>
          <span className="pk-clock" style={{ flex: "0 0 56px" }}>{e.allDay ? "all day" : e.time}</span>
          <span className="pk-tasktext">{e.title}</span>
          {e.source === "google" ? (
            <span className="pk-tag work">google</span>
          ) : (
            <span className="pk-x" onClick={() => remove(e.id)}>×</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ----- Habits --------------------------------------------------------------

function Habits({ state, setState }) {
  const [nudge, setNudge] = useState("");
  const [loading, setLoading] = useState(false);

  const toggle = (key) => {
    setState((s) => {
      const wasDone = s.habits[key];
      const habits = { ...s.habits, [key]: !wasDone };
      const streaks = { ...s.streaks };
      if (!wasDone) {
        const last = streaks[key].last;
        const cont = last === yesterdayStr() || last === todayStr();
        const inc = last === todayStr() ? 0 : 1;
        streaks[key] = { count: cont ? streaks[key].count + inc : 1, last: todayStr() };
      } else {
        const newCount = Math.max(0, streaks[key].count - 1);
        streaks[key] = { count: newCount, last: newCount <= 0 ? null : streaks[key].last };
      }
      return { ...s, habits, streaks };
    });
  };

  const getNudge = async () => {
    setLoading(true);
    setNudge("");
    const txt = await askAI(
      "Give me one tiny, low friction way to start meditating right now, something I can do in under two minutes without an app or any setup. Be warm and concrete. One short paragraph, no lists.",
      { system: "You are a calm, encouraging meditation guide for someone with ADHD who finds stillness hard. Suggest novel, gentle micro practices. Never shame. Keep it short and doable." }
    );
    setNudge(txt);
    setLoading(false);
  };

  const habitList = [["swim", "swim", "🏊"], ["gym", "gym", "🏋️"], ["meditation", "meditate", "🧘"]];

  return (
    <>
      <div className="pk-card">
        <h3 className="pk-h">Today's habits</h3>
        <p className="pk-sub">Tap to mark done. Missed days do not reset you to zero in a harsh way, just keep showing up.</p>
        <div className="pk-grid3">
          {habitList.map(([key, label, icon]) => (
            <div className={`pk-habit ${state.habits[key] ? "on" : ""}`} key={key}>
              <span className="pk-habitname">{label}</span>
              <button className="pk-habitbtn" onClick={() => toggle(key)}>
                {state.habits[key] ? "✅" : icon}
              </button>
              <span className="pk-streak">{state.streaks[key].count} day streak</span>
            </div>
          ))}
        </div>
      </div>
      <div className="pk-card">
        <h3 className="pk-h">Meditation nudge</h3>
        <p className="pk-sub">Not feeling it? Get one fresh, tiny way in.</p>
        <button className="pk-btn cy" onClick={getNudge} disabled={loading}>
          {loading ? <span className="pk-spin" /> : "give me a nudge"}
        </button>
        {nudge && <div className="pk-ai">{nudge}</div>}
      </div>
    </>
  );
}

// ----- Tasks ---------------------------------------------------------------

function Tasks({ state, setState }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState("personal");
  const [unstick, setUnstick] = useState("");
  const [reads, setReads] = useState("");
  const [loadingU, setLoadingU] = useState(false);
  const [loadingR, setLoadingR] = useState(false);

  const add = () => {
    if (!text.trim()) return;
    setState((s) => ({ ...s, tasks: [...s.tasks, { id: uid(), text: text.trim(), kind, done: false }] }));
    setText("");
  };
  const toggle = (id) => setState((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }));
  const remove = (id) => setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));

  const open = state.tasks.filter((t) => !t.done);

  const doUnstick = async () => {
    setLoadingU(true);
    setUnstick("");
    const list = open.map((t) => `- (${t.kind}) ${t.text}`).join("\n") || "no tasks listed yet";
    const txt = await askAI(
      `Here is my task list. I feel paralysed and cannot start.\n${list}\n\nPick ONE task and break it into the single smallest first step I can do in five minutes. Then give me one short, real line of motivation. Keep it under 80 words, warm, no lists. Do not invent any book or paper titles.`,
      { system: "You are a kind ADHD coach. You reduce overwhelm by naming one tiny next step. You never pile on. You never fabricate references." }
    );
    setUnstick(txt);
    setLoadingU(false);
  };

  const doReads = async () => {
    setLoadingR(true);
    setReads("");
    const txt = await askAI(
      "Find me 2 or 3 genuinely interesting, recent things to read or watch that would inspire someone working in AI, computer vision, and 3D reconstruction. Use web search so links are real. Give the title, a one line why, and the real link for each. Keep it short.",
      { search: true, system: "You surface real, current, inspiring reads. Only use links you actually found via search. Never invent a title or URL." }
    );
    setReads(txt);
    setLoadingR(false);
  };

  return (
    <>
      <div className="pk-card">
        <h3 className="pk-h">Brain dump</h3>
        <p className="pk-sub">Drop everything here, personal and work. Getting it out of your head is half the battle.</p>
        <div className="pk-row" style={{ marginBottom: 10 }}>
          <input
            className="pk-in"
            placeholder="what needs doing?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className="pk-btn" onClick={add}>add</button>
        </div>
        <div className="pk-row" style={{ marginBottom: 16 }}>
          <button className={`pk-toggle ${kind === "personal" ? "on" : ""}`} onClick={() => setKind("personal")}>personal</button>
          <button className={`pk-toggle ${kind === "work" ? "on" : ""}`} onClick={() => setKind("work")}>work</button>
        </div>
        {state.tasks.length === 0 && <p className="pk-sub" style={{ margin: 0 }}>Empty for now. Dump one thing.</p>}
        {state.tasks.map((t) => (
          <div className="pk-item" key={t.id}>
            <div className={`pk-check ${t.done ? "on" : ""}`} onClick={() => toggle(t.id)}>{t.done ? "✓" : ""}</div>
            <span className={`pk-tasktext ${t.done ? "done" : ""}`}>{t.text}</span>
            <span className={`pk-tag ${t.kind}`}>{t.kind}</span>
            <span className="pk-x" onClick={() => remove(t.id)}>×</span>
          </div>
        ))}
      </div>

      <div className="pk-card">
        <h3 className="pk-h">Stuck? Unstick me</h3>
        <p className="pk-sub">One tiny next step plus a real push, pulled from your list above.</p>
        <button className="pk-btn" onClick={doUnstick} disabled={loadingU}>
          {loadingU ? <span className="pk-spin" /> : "unstick me"}
        </button>
        {unstick && <div className="pk-ai">{unstick}</div>}
      </div>

      <div className="pk-card">
        <h3 className="pk-h">Inspire me</h3>
        <p className="pk-sub">Fresh, real things to read in your field. Pulled live from the web so links actually work.</p>
        <button className="pk-btn cy" onClick={doReads} disabled={loadingR}>
          {loadingR ? <span className="pk-spin" /> : "find me a read"}
        </button>
        {reads && <div className="pk-ai" dangerouslySetInnerHTML={{ __html: linkify(reads) }} />}
      </div>
    </>
  );
}

// ----- Insta ---------------------------------------------------------------

function Insta({ state, setState }) {
  const [followers, setFollowers] = useState("");
  const [note, setNote] = useState("");
  const [ideas, setIdeas] = useState("");
  const [loading, setLoading] = useState(false);

  const log = state.insta.log;
  const latest = log.length ? log[log.length - 1] : null;
  const prev = log.length > 1 ? log[log.length - 2] : null;
  const delta = latest && prev ? latest.followers - prev.followers : null;

  const addLog = () => {
    const n = parseInt(followers, 10);
    if (isNaN(n)) return;
    setState((s) => ({
      ...s,
      insta: { ...s.insta, log: [...s.insta.log, { date: todayStr(), followers: n, note: note.trim() }] },
    }));
    setFollowers("");
    setNote("");
  };

  const getIdeas = async () => {
    setLoading(true);
    setIdeas("");
    const txt = await askAI(
      "Find current, real tips for growing a small Instagram account focused on a travel diary, in 2026. Use web search so advice is up to date. Give me 3 concrete content ideas to try this week and 2 growth tactics, each with the real source link. Keep it short and practical.",
      { search: true, system: "You give current, honest Instagram growth advice for a small creator. Use only real links from search. Note that tactics change often. Never fabricate a source." }
    );
    setIdeas(txt);
    setLoading(false);
  };

  return (
    <>
      <div className="pk-card">
        <h3 className="pk-h">Travel diary tracker</h3>
        <p className="pk-sub">
          Heads up: no app can read Instagram's ranking algorithm, nobody has that access. You can track your own
          numbers though. Log your follower count whenever you check, and watch the trend.
        </p>
        {latest && (
          <div className="pk-row" style={{ alignItems: "baseline", marginBottom: 12 }}>
            <span className="pk-metric">{latest.followers.toLocaleString()}</span>
            {delta !== null && (
              <span style={{ color: delta >= 0 ? "var(--ok)" : "var(--pink)", fontFamily: "var(--mono)", fontSize: 13 }}>
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} since last log
              </span>
            )}
          </div>
        )}
        <div className="pk-row" style={{ marginBottom: 8 }}>
          <input className="pk-in pk-time" type="number" placeholder="followers" value={followers} onChange={(e) => setFollowers(e.target.value)} />
          <input className="pk-in" placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="pk-btn" onClick={addLog}>log</button>
        </div>
        {log.length === 0 && <p className="pk-sub" style={{ margin: 0 }}>No entries yet. Log your current count to start the trend.</p>}
        {log.slice().reverse().slice(0, 6).map((entry, i) => (
          <div className="pk-item" key={i}>
            <span className="pk-clock" style={{ flex: "0 0 92px" }}>{entry.date}</span>
            <span className="pk-tasktext">{entry.followers.toLocaleString()} {entry.note ? `· ${entry.note}` : ""}</span>
          </div>
        ))}
      </div>

      <div className="pk-card">
        <h3 className="pk-h">Ideas and growth reads</h3>
        <p className="pk-sub">Current content ideas and growth tactics, pulled live so nothing is stale.</p>
        <button className="pk-btn cy" onClick={getIdeas} disabled={loading}>
          {loading ? <span className="pk-spin" /> : "give me ideas"}
        </button>
        {ideas && <div className="pk-ai" dangerouslySetInnerHTML={{ __html: linkify(ideas) }} />}
        <p className="pk-note">Growth tactics change constantly, so treat these as starting points, not rules.</p>
      </div>
    </>
  );
}


// ----- Study Tree ----------------------------------------------------------
// A growing library of what you're learning. Roots are the basics every
// ML/CV engineer needs; branches are the advanced topics. Each topic holds
// links you paste in. Data lives in state.tree, so it saves automatically
// like everything else. Manual sorting for now; an AI "sort my dumped links"
// button can be added later by adding an `inbox` array — the link shape below
// (an object, not a bare string) is already ready for that.

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
  };
}

function StudyTree({ state, setState }) {
  // Old saved data won't have a tree yet. This seeds it once, the first time
  // you open the tab, then leaves it alone. This one guard is why the tab
  // never crashes on an account that existed before you added this feature.
  useEffect(() => {
    if (!state.tree) setState((s) => (s.tree ? s : { ...s, tree: defaultTree() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tree = state.tree || { groups: [] };

  const [openTopic, setOpenTopic] = useState(null); // which topic is expanded
  const [draft, setDraft] = useState({});           // {topicId: {url, note}} being typed
  const [newTopic, setNewTopic] = useState({});     // {groupId: label} being typed

  const save = (next) => setState((s) => ({ ...s, tree: next }));

  const totalLinks = tree.groups.reduce(
    (n, g) => n + g.topics.reduce((m, t) => m + t.links.length, 0),
    0
  );

  const addLink = (gid, tid) => {
    const d = draft[tid] || {};
    const url = (d.url || "").trim();
    if (!url) return;
    const link = { id: uid(), url, note: (d.note || "").trim(), added: todayStr() };
    save({
      ...tree,
      groups: tree.groups.map((g) =>
        g.id !== gid ? g : { ...g, topics: g.topics.map((t) => (t.id !== tid ? t : { ...t, links: [link, ...t.links] })) }
      ),
    });
    setDraft((x) => ({ ...x, [tid]: { url: "", note: "" } }));
  };

  const removeLink = (gid, tid, lid) => {
    save({
      ...tree,
      groups: tree.groups.map((g) =>
        g.id !== gid ? g : { ...g, topics: g.topics.map((t) => (t.id !== tid ? t : { ...t, links: t.links.filter((l) => l.id !== lid) })) }
      ),
    });
  };

  const addTopic = (gid) => {
    const label = (newTopic[gid] || "").trim();
    if (!label) return;
    save({
      ...tree,
      groups: tree.groups.map((g) => (g.id !== gid ? g : { ...g, topics: [...g.topics, { id: uid(), label, links: [] }] })),
    });
    setNewTopic((x) => ({ ...x, [gid]: "" }));
  };

  const removeTopic = (gid, tid) => {
    save({
      ...tree,
      groups: tree.groups.map((g) => (g.id !== gid ? g : { ...g, topics: g.topics.filter((t) => t.id !== tid) })),
    });
  };

  return (
    <>
      <div className="pk-card">
        <h3 className="pk-h">Study tree</h3>
        <p className="pk-sub">
          Your growing map of what a multimodal ML / CV engineer needs. Roots are the basics, branches are the advanced
          topics. Tap a topic, paste a link, and it lives there. {totalLinks} link{totalLinks === 1 ? "" : "s"} saved so far.
        </p>
      </div>

      {tree.groups.map((g) => (
        <div className="pk-card" key={g.id}>
          <h3 className="pk-h" style={{ color: g.id === "basics" ? "var(--ok)" : "var(--pinkSoft)" }}>{g.label}</h3>

          {g.topics.map((t) => {
            const isOpen = openTopic === t.id;
            const d = draft[t.id] || {};
            return (
              <div key={t.id} style={{ borderBottom: "1px solid var(--line)", padding: "10px 0" }}>
                <div
                  className="pk-row"
                  style={{ justifyContent: "space-between", cursor: "pointer" }}
                  onClick={() => setOpenTopic(isOpen ? null : t.id)}
                >
                  <span className="pk-tasktext" style={{ fontWeight: 600 }}>
                    {isOpen ? "▾" : "▸"} {t.label}
                  </span>
                  <span className="pk-tag work" style={{ flex: "0 0 auto" }}>{t.links.length}</span>
                </div>

                {isOpen && (
                  <div style={{ marginTop: 10, paddingLeft: 6 }}>
                    <div className="pk-row" style={{ marginBottom: 8 }}>
                      <input
                        className="pk-in"
                        placeholder="paste a link (https://...)"
                        value={d.url || ""}
                        onChange={(e) => setDraft((x) => ({ ...x, [t.id]: { ...d, url: e.target.value } }))}
                        onKeyDown={(e) => e.key === "Enter" && addLink(g.id, t.id)}
                      />
                    </div>
                    <div className="pk-row" style={{ marginBottom: 12 }}>
                      <input
                        className="pk-in"
                        placeholder="note (optional)"
                        value={d.note || ""}
                        onChange={(e) => setDraft((x) => ({ ...x, [t.id]: { ...d, note: e.target.value } }))}
                        onKeyDown={(e) => e.key === "Enter" && addLink(g.id, t.id)}
                      />
                      <button className="pk-btn" onClick={() => addLink(g.id, t.id)}>add</button>
                    </div>

                    {t.links.length === 0 && <p className="pk-sub" style={{ margin: 0 }}>No links yet. Paste your first one.</p>}
                    {t.links.map((l) => (
                      <div className="pk-item" key={l.id}>
                        <span className="pk-tasktext" style={{ wordBreak: "break-all" }}>
                          <a href={l.url} target="_blank" rel="noopener noreferrer">{l.url}</a>
                          {l.note ? <span style={{ color: "var(--muted)" }}> · {l.note}</span> : null}
                        </span>
                        <span className="pk-clock" style={{ flex: "0 0 auto" }}>{l.added}</span>
                        <span className="pk-x" onClick={() => removeLink(g.id, t.id, l.id)}>×</span>
                      </div>
                    ))}

                    <div style={{ marginTop: 10 }}>
                      <span
                        onClick={() => removeTopic(g.id, t.id)}
                        style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--muted)", cursor: "pointer" }}
                      >
                        delete topic
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div className="pk-row" style={{ marginTop: 14 }}>
            <input
              className="pk-in"
              placeholder="add a topic to this branch"
              value={newTopic[g.id] || ""}
              onChange={(e) => setNewTopic((x) => ({ ...x, [g.id]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && addTopic(g.id)}
            />
            <button className="pk-btn cy" onClick={() => addTopic(g.id)}>+ topic</button>
          </div>
        </div>
      ))}
    </>
  );
}
