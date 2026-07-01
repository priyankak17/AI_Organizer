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

// Trim a long label so it fits inside a small tree node.
const short = (s, n = 15) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// The AI is told to reply with pure JSON, but models sometimes wrap it in
// ```json fences or add a stray word. This digs the array out safely.
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
  };
}

function StudyTree({ state, setState }) {
  useEffect(() => {
    if (!state.tree) setState((s) => (s.tree ? s : { ...s, tree: defaultTree() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tree = state.tree || { groups: [] };
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({});
  const [newTopic, setNewTopic] = useState({});
  const [dump, setDump] = useState("");
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sortErr, setSortErr] = useState("");

  const save = (next) => setState((s) => ({ ...s, tree: next }));

  const allTopics = tree.groups.flatMap((g) => g.topics.map((t) => ({ ...t, groupId: g.id })));
  const findTopic = (id) => allTopics.find((t) => t.id === id);
  const selTopic = selected ? findTopic(selected) : null;

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

  // --- REAL AI sort: one Gemini call, returns JSON we parse into suggestions.
  const runSort = async () => {
    const urls = dump.split(/[\n\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length) return;
    setBusy(true);
    setSortErr("");
    setReview(null);

    const topicList = allTopics.map((t) => `${t.id} — ${t.label}`).join("\n");
    const prompt =
      `Here are my study topics as "id — label":\n${topicList}\n\n` +
      `Sort each of these links into the single best-matching topic id:\n${urls.join("\n")}\n\n` +
      `Return ONLY a JSON array, no prose and no code fences, like:\n` +
      `[{"url":"https://...","topicId":"attention"}]`;

    const text = await askAI(prompt, {
      system:
        "You sort study links into topics. Reply with ONLY a raw JSON array. " +
        "Each item is {\"url\": string, \"topicId\": string}. topicId must be exactly one of the ids given. If unsure, pick the closest.",
    });

    const parsed = extractJson(text);
    const validIds = new Set(allTopics.map((t) => t.id));
    let suggestions;

    if (Array.isArray(parsed)) {
      const byUrl = {};
      for (const p of parsed) if (p && p.url) byUrl[String(p.url).trim()] = p.topicId;
      suggestions = urls.map((url) => {
        let id = byUrl[url];
        if (!validIds.has(id)) id = allTopics[0] ? allTopics[0].id : null;
        return { url, topicId: id };
      });
    } else {
      setSortErr("The AI reply could not be read cleanly, so everything defaulted to the first topic. Fix the dropdowns, then file.");
      suggestions = urls.map((url) => ({ url, topicId: allTopics[0] ? allTopics[0].id : null }));
    }

    setReview(suggestions);
    setBusy(false);
  };

  const commitReview = () => {
    let next = tree;
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
    }
    save(next);
    setReview(null);
    setDump("");
    setSortErr("");
  };

  // ---- SVG layout, computed from the data ----
  const W = 360;
  const cx = W / 2;
  const gap = 58;
  const adv = tree.groups.find((g) => g.id === "advanced")?.topics || [];
  const bas = tree.groups.find((g) => g.id === "basics")?.topics || [];
  const topPad = 24;
  const centerY = topPad + adv.length * gap + 20;
  const H = centerY + bas.length * gap + topPad + 20;

  const nodeFor = (t, i, dir) => {
    const side = i % 2 === 0 ? 1 : -1;
    const y = centerY + dir * (i + 1) * gap;
    const nodeCx = cx + side * 96;
    const boxW = 128, boxH = 30;
    const bx = nodeCx - boxW / 2;
    const by = y - boxH / 2;
    const innerX = side === 1 ? bx : bx + boxW;
    const ctrlY = y + dir * -18;
    const path = `M ${cx} ${centerY + dir * (i + 0.15) * gap} Q ${cx + side * 40} ${ctrlY} ${innerX} ${y}`;
    return { t, y, bx, by, boxW, boxH, path, isSel: selected === t.id, isRoot: dir === 1 };
  };
  const nodes = [
    ...adv.map((t, i) => nodeFor(t, i, -1)),
    ...bas.map((t, i) => nodeFor(t, i, 1)),
  ];

  return (
    <>
      <div className="pk-card">
        <h3 className="pk-h">Dump &amp; sort</h3>
        <p className="pk-sub">
          Paste a pile of links (one per line). The AI suggests a topic for each. You review and fix before anything is
          filed — it never files blindly.
        </p>
        <textarea
          className="pk-in"
          style={{ minHeight: 70, width: "100%", resize: "vertical", fontFamily: "var(--mono)", fontSize: 12 }}
          placeholder={"https://arxiv.org/abs/1706.03762\nhttps://github.com/ultralytics/yolov5"}
          value={dump}
          onChange={(e) => setDump(e.target.value)}
        />
        <div className="pk-row" style={{ marginTop: 10 }}>
          <button className="pk-btn cy" onClick={runSort} disabled={busy || !dump.trim()}>
            {busy ? <span className="pk-spin" /> : "sort with ai"}
          </button>
        </div>
        {sortErr && <p className="pk-sub" style={{ color: "var(--pink)", marginTop: 10, marginBottom: 0 }}>{sortErr}</p>}

        {review && (
          <div style={{ marginTop: 14, borderTop: "1px dashed #3a3a4a", paddingTop: 12 }}>
            <p className="pk-sub" style={{ marginBottom: 8 }}>Review the AI's guesses. Change any dropdown, then file.</p>
            {review.map((r, i) => (
              <div className="pk-item" key={i}>
                <span className="pk-tasktext" style={{ wordBreak: "break-all", fontSize: 12 }}>{r.url}</span>
                <select
                  className="pk-in"
                  style={{ flex: "0 0 150px", minWidth: 120, padding: "6px 8px", fontSize: 12 }}
                  value={r.topicId || ""}
                  onChange={(e) => setReview((rv) => rv.map((x, j) => (j === i ? { ...x, topicId: e.target.value } : x)))}
                >
                  {allTopics.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
            ))}
            <div className="pk-row" style={{ marginTop: 10 }}>
              <button className="pk-btn" onClick={commitReview}>file all</button>
              <span className="pk-x" style={{ fontFamily: "var(--mono)", fontSize: 12 }} onClick={() => setReview(null)}>cancel</span>
            </div>
          </div>
        )}
      </div>

      <div className="pk-card">
        <h3 className="pk-h">Your tree</h3>
        <p className="pk-sub">Branches up top are advanced topics, roots below are the basics. Tap any node to open its links.</p>
        <div style={{ overflowX: "auto" }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: "block", margin: "0 auto" }}>
            <defs>
              <linearGradient id="trunk" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--pinkSoft)" />
                <stop offset="50%" stopColor="var(--muted)" />
                <stop offset="100%" stopColor="var(--ok)" />
              </linearGradient>
            </defs>
            <rect x={cx - 4} y={topPad} width="8" height={H - topPad * 2} rx="4" fill="url(#trunk)" opacity="0.55" />
            {nodes.map((n) => (
              <path key={"c" + n.t.id} d={n.path} fill="none" stroke={n.isRoot ? "var(--ok)" : "var(--pinkSoft)"} strokeWidth="1.5" opacity="0.5" />
            ))}
            {nodes.map((n) => (
              <g key={n.t.id} style={{ cursor: "pointer" }} onClick={() => setSelected(n.t.id)}>
                <rect x={n.bx} y={n.by} width={n.boxW} height={n.boxH} rx="15"
                  fill={n.isSel ? (n.isRoot ? "rgba(84,242,194,.18)" : "rgba(255,132,189,.18)") : "var(--panel2)"}
                  stroke={n.isRoot ? "var(--ok)" : "var(--pinkSoft)"} strokeWidth={n.isSel ? 2 : 1} />
                <text x={n.bx + 12} y={n.y + 4} fontSize="11" fontFamily="var(--mono)" fill="var(--text)">{short(n.t.label)}</text>
                <circle cx={n.bx + n.boxW - 13} cy={n.y} r="9" fill={n.isRoot ? "var(--ok)" : "var(--pinkSoft)"} />
                <text x={n.bx + n.boxW - 13} y={n.y + 3} fontSize="10" fontFamily="var(--mono)" fill="#0a0a0f" textAnchor="middle" fontWeight="700">{n.t.links.length}</text>
              </g>
            ))}
          </svg>
        </div>

        <div className="pk-row" style={{ marginTop: 8 }}>
          <input className="pk-in" placeholder="new branch (advanced)" value={newTopic.advanced || ""}
            onChange={(e) => setNewTopic((x) => ({ ...x, advanced: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && addTopic("advanced")} />
          <button className="pk-btn" onClick={() => addTopic("advanced")}>+</button>
        </div>
        <div className="pk-row" style={{ marginTop: 6 }}>
          <input className="pk-in" placeholder="new root (basic)" value={newTopic.basics || ""}
            onChange={(e) => setNewTopic((x) => ({ ...x, basics: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && addTopic("basics")} />
          <button className="pk-btn cy" onClick={() => addTopic("basics")}>+</button>
        </div>
      </div>

      <div className="pk-card">
        {!selTopic && <p className="pk-sub" style={{ margin: 0 }}>Tap a node in the tree to open it.</p>}
        {selTopic && (
          <>
            <div className="pk-row" style={{ justifyContent: "space-between" }}>
              <h3 className="pk-h" style={{ margin: 0 }}>{selTopic.label}</h3>
              <span className="pk-x" style={{ fontFamily: "var(--mono)", fontSize: 11 }} onClick={() => removeTopic(selTopic.groupId, selTopic.id)}>delete topic</span>
            </div>
            <div className="pk-row" style={{ margin: "12px 0 8px" }}>
              <input className="pk-in" placeholder="paste a link" value={draft.url || ""}
                onChange={(e) => setDraft((x) => ({ ...x, url: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") { addLink(selTopic.groupId, selTopic.id, draft.url, draft.note); setDraft({}); } }} />
              <input className="pk-in" placeholder="note" style={{ flex: "0 0 90px", minWidth: 70 }} value={draft.note || ""}
                onChange={(e) => setDraft((x) => ({ ...x, note: e.target.value }))} />
              <button className="pk-btn" onClick={() => { addLink(selTopic.groupId, selTopic.id, draft.url, draft.note); setDraft({}); }}>add</button>
            </div>
            {selTopic.links.length === 0 && <p className="pk-sub" style={{ margin: 0 }}>No links yet.</p>}
            {selTopic.links.map((l) => (
              <div className="pk-item" key={l.id}>
                <span className="pk-tasktext" style={{ wordBreak: "break-all" }}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer">{l.url}</a>
                  {l.note ? <span style={{ color: "var(--muted)" }}> · {l.note}</span> : null}
                </span>
                <span className="pk-x" onClick={() => removeLink(selTopic.groupId, selTopic.id, l.id)}>×</span>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
