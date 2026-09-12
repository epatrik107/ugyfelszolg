import { Copy, Download, Pencil, Check, Undo2 } from "lucide-react";
import { useId, useState } from "react";

/** Local edits never overwrite the purchased server-side versions. */
export function LetterDocument({ original, history = [] }: { original: string; history?: string[] }) {
  const editorId = useId();
  const versionId = useId();
  const [version, setVersion] = useState("current");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const source = version === "current" ? original : history[Number(version)] ?? original;
  const text = Object.hasOwn(drafts, source) ? drafts[source] : source;
  const dirty = text !== source;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("A megjelenített változatot kimásoltuk.");
    } catch {
      setNotice("A másolást a böngésző nem engedélyezte. Töltse le a szöveget, vagy jelölje ki és másolja ki kézzel.");
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "levelseged-level.txt";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("A megjelenített változat letöltése elindult.");
  }
  return <section className="space-y-4" aria-label="Levél megtekintése és szerkesztése">
    {history.length > 0 && <div className="grid gap-2 text-sm font-medium"><label htmlFor={versionId}>Megjelenített változat</label>
      <select id={versionId} className="input" value={version} onChange={(event) => { setVersion(event.target.value); setNotice(""); }}>
        <option value="current">Legújabb változat</option>
        {history.map((_, index) => <option key={index} value={String(index)}>{index + 1}. korábbi változat</option>)}
      </select>
    </div>}
    <div className="letter-paper rounded-xl border border-slate-200 bg-white p-5 shadow-soft sm:p-10">
      <p className="mb-5 border-b border-slate-100 pb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">{dirty ? "Saját szerkesztés" : "Hivatalos levél"}</p>
      {editing ? <div className="grid gap-2 text-sm font-medium"><label htmlFor={editorId}>Levél szövegének szerkesztése</label>
        <textarea id={editorId} className="input min-h-[28rem] leading-8" value={text} onChange={(event) => { setDrafts((current) => ({ ...current, [source]: event.target.value })); setNotice(""); }} />
      </div> : <div data-testid="letter-text" className="whitespace-pre-wrap break-words font-serif text-base leading-8 text-slate-800">{text}</div>}
    </div>
    <div className="sticky bottom-0 z-10 grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-lg sm:static sm:flex sm:flex-wrap sm:shadow-none">
      <button className="button-secondary px-2 text-sm" onClick={() => { setEditing(!editing); setNotice(""); }}>{editing ? <Check size={17} /> : <Pencil size={17} />}{editing ? "Kész" : "Szerkesztés"}</button>
      <button className="button-primary px-2 text-sm" disabled={!text.trim()} onClick={() => void copy()}><Copy size={17} />Másolás</button>
      <button className="button-secondary px-2 text-sm" disabled={!text.trim()} onClick={download}><Download size={17} />Letöltés</button>
    </div>
    <p role="status" className="text-sm text-slate-600">{notice}</p>
    {(editing || dirty) && <div className="space-y-2 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
      <p>A kézi szerkesztés nem fogyaszt AI-módosítást. A Másolás és Letöltés ezt a szöveget használja. A szerkesztést csak ezen az oldalon tartjuk meg; bezárás előtt töltse le.</p>
      <p>Az emailküldés és az AI-módosítás a mentett, szerkesztés előtti levélváltozatot használja.</p>
      {dirty && <button type="button" className="button-secondary text-sm" onClick={() => { setDrafts((current) => { const next = { ...current }; delete next[source]; return next; }); setNotice("A mentett levélváltozatot visszaállítottuk."); }}><Undo2 size={16} />Szerkesztés visszavonása</button>}
    </div>}
  </section>;
}
